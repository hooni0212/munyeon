import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { normalizeText } from '../shared/text.js';

export const FILE_LIMIT = 10 * 1024 * 1024;
export const TEXT_LIMIT = 60000;
export const fileTypes = {
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));

function problem(message) {
  return Object.assign(new Error(message), { status: 422, code: 'FILE_UNREADABLE' });
}

export function fileKind(name) {
  const extension = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return Object.hasOwn(fileTypes, extension) ? extension : null;
}

async function pdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
      cMapUrl: join(pdfRoot, 'cmaps') + '/', cMapPacked: true, standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/',
      verbosity: 0,
    }).promise;
  } catch {
    throw problem('PDF를 열 수 없어요. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.');
  }
  const paragraphs = [];
  try {
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      // 글자 사이 간격으로 띄어쓰기를 복원하고, 줄 간격과 줄 끝 위치로 문단을 나눈다.
      const lines = [];
      let line = null;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const piece = item.str.replace(/[\u0000-\u001f]/g, ' ');
        const [x, y] = [item.transform[4], item.transform[5]];
        if (line && Math.abs(y - line.y) > 1 && line.text.trim()) {
          lines.push(line);
          line = null;
        }
        if (!line) line = { y, left: x, right: x, height: 0, text: '' };
        if (piece) {
          const gap = x - line.right;
          if (line.text && gap > (item.height || line.height || 10) * 0.2 && !/\s$/.test(line.text) && !/^\s/.test(piece)) line.text += ' ';
          line.text += piece;
          line.right = Math.max(line.right, x + (item.width || 0));
          line.height = Math.max(line.height, item.height || 0);
        }
        if (item.hasEOL && line.text.trim()) {
          lines.push(line);
          line = null;
        }
      }
      if (line?.text.trim()) lines.push(line);
      const gaps = lines.slice(1).map((entry, index) => Math.abs(lines[index].y - entry.y))
        .filter((gap, index) => gap >= (lines[index].height || 1) * 0.5);
      const spacing = gaps.length ? Math.min(...gaps) : 0;
      const widest = Math.max(0, ...lines.map(entry => entry.right));
      let current = '';
      lines.forEach((entry, index) => {
        const previous = lines[index - 1];
        const gap = previous ? Math.abs(previous.y - entry.y) : 0;
        const wide = spacing && gap > spacing * 1.35;
        const shortEnd = previous && previous.right < widest * 0.85 && /[.?!。다요]\s*$/.test(previous.text);
        if (current && (wide || shortEnd)) {
          paragraphs.push(current);
          current = '';
        }
        const text = entry.text.replace(/\s+/g, ' ').trim();
        if (!text) return;
        current = current ? current + (/[-–]$/.test(current) ? '' : ' ') + text : text;
      });
      if (current) paragraphs.push(current);
    }
  } finally {
    await document.destroy();
  }
  return paragraphs.join('\n\n');
}

async function docxText(buffer) {
  const mammoth = (await import('mammoth')).default;
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.replace(/\n{2,}/g, '\n\n');
  } catch {
    throw problem('Word 파일을 읽을 수 없어요. .docx 형식인지 확인해 주세요.');
  }
}

export async function extractText(name, buffer) {
  const kind = fileKind(name);
  if (!kind) throw problem('.txt, .pdf, .docx 파일만 올릴 수 있어요.');
  if (buffer.length > FILE_LIMIT) throw Object.assign(new Error('10 MB 이하의 파일을 올려 주세요.'), { status: 413, code: 'FILE_TOO_LARGE' });
  let text;
  if (kind === 'txt') {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch {
      throw problem('텍스트 파일을 읽을 수 없어요. UTF-8로 저장한 파일을 올려 주세요.');
    }
  } else text = kind === 'pdf' ? await pdfText(buffer) : await docxText(buffer);
  text = normalizeText(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw problem(kind === 'pdf' ? '파일에서 텍스트를 찾지 못했어요. 스캔한 이미지형 PDF는 지원하지 않아요.' : '파일에 텍스트가 없어요.');
  if (text.length > TEXT_LIMIT) throw Object.assign(new Error('본문이 ' + TEXT_LIMIT.toLocaleString('ko-KR') + '자를 넘어요.'), { status: 413, code: 'TEXT_TOO_LONG' });
  return { kind, mime: fileTypes[kind], text };
}
