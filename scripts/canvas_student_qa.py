#!/usr/bin/env python3
"""Read-only personal Canvas QA. No credentials or raw submissions are saved."""
import argparse
import json
import os
import re
import ssl
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler

class CanvasError(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CanvasError('Redirect refused')

class CanvasReader:
    def __init__(self, base, token):
        parsed = urlsplit(base)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            raise CanvasError('HTTPS origin required')
        self.base = base.rstrip('/')
        self.origin = (parsed.scheme, parsed.netloc)
        self.token = token
        self.opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
        self.requests = 0

    def validate(self, value):
        url = urljoin(self.base + '/', value)
        p = urlsplit(url)
        allowed = r'/api/v1/(?:users/self/profile|courses|courses/\d+(?:/permissions|/assignments(?:/\d+/submissions/self)?)?)'
        if (p.scheme, p.netloc) != self.origin or p.username or p.password or p.fragment or not re.fullmatch(allowed, p.path):
            raise CanvasError('Unexpected Canvas URL refused')
        return url

    def get(self, path):
        url = self.validate(path)
        self.requests += 1
        req = Request(url, method='GET', headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json+canvas-string-ids'})
        try:
            with self.opener.open(req, timeout=20) as response:
                return json.load(response), response.headers.get('Link', '')
        except HTTPError as e:
            raise CanvasError('HTTP ' + str(e.code)) from None
        except (URLError, TimeoutError):
            raise CanvasError('Canvas network unavailable') from None

    def pages(self, path):
        result, seen = [], set()
        while path:
            url = self.validate(path)
            if url in seen or len(seen) >= 100:
                raise CanvasError('Pagination limit or cycle')
            seen.add(url)
            data, links = self.get(url)
            if not isinstance(data, list):
                raise CanvasError('Expected list')
            result.extend(data)
            nxt = re.search(r'<([^>]+)>;\s*rel="next"', links)
            path = nxt.group(1) if nxt else None
        return result, len(seen)


def token_from(path):
    if os.getenv('CANVAS_ACCESS_TOKEN', '').strip():
        return os.environ['CANVAS_ACCESS_TOKEN'].strip()
    if path and path.is_file():
        for line in path.read_text().splitlines():
            if line.strip().startswith('CANVAS_ACCESS_TOKEN='):
                return line.split('=', 1)[1].strip().strip('\"\'')
    raise CanvasError('Existing Canvas token unavailable')


def run(reader, term):
    me, _ = reader.get('/api/v1/users/self/profile')
    courses, page_count = reader.pages('/api/v1/courses?' + urlencode({'enrollment_state':'active','include[]':'term','per_page':2}))
    current = [c for c in courses if (c.get('term') or {}).get('name') == term]
    report = {'checked_at': datetime.now().astimezone().isoformat(), 'term':term, 'mode':'GET only; private local QA', 'identity_verified':bool(me.get('id')), 'course_list_pages':page_count, 'courses':[], 'cross_course':[], 'errors':[]}
    if not current:
        raise CanvasError('No courses in selected term')
    samples = []
    for c in current:
        cid = str(c['id'])
        row = {'id':cid,'name':c.get('name'), 'roles':[e.get('type') for e in c.get('enrollments',[]) if e.get('type')], 'checks':{}}
        report['courses'].append(row)
        try:
            detail,_=reader.get('/api/v1/courses/'+cid)
            row['checks']['course_identity']=str(detail.get('id'))==cid
            q=urlencode([('permissions[]','manage_grades'),('permissions[]','manage_assignments'),('permissions[]','manage_students')])
            try:
                permissions,_=reader.get('/api/v1/courses/'+cid+'/permissions?'+q)
                row['permissions']=permissions
            except CanvasError as e:
                row['permissions_error']=str(e)
            assignments, pages=reader.pages('/api/v1/courses/'+cid+'/assignments?'+urlencode({'include[]':'submission','per_page':100}))
            row['assignment_count']=len(assignments)
            row['assignment_pages']=pages
            row['checks']['assignment_course_ids']=all(str(a.get('course_id'))==cid for a in assignments)
            submissions=[a['submission'] for a in assignments if isinstance(a.get('submission'),dict)]
            row['own_submission_status_count']=len(submissions)
            row['checks']['embedded_submissions_self']=all(str(s.get('user_id'))==str(me['id']) for s in submissions)
            if assignments:
                sample=assignments[0]
                aid=str(sample['id'])
                samples.append((cid,aid))
                try:
                    sub,_=reader.get(f'/api/v1/courses/{cid}/assignments/{aid}/submissions/self')
                    row['checks']['self_submission_identity']=str(sub.get('user_id'))==str(me['id']) and str(sub.get('assignment_id'))==aid
                except CanvasError as e:
                    row['self_submission_error']=str(e)
        except CanvasError as e:
            report['errors'].append({'course_id':cid,'error':str(e)})
    if len(samples)>=2:
        for (a,aid),(b,_) in [(samples[0],samples[1]),(samples[1],samples[0])]:
            try:
                data,_=reader.get(f'/api/v1/courses/{b}/assignments/{aid}/submissions/self')
                result={'source_course':a,'target_course':b,'assignment_id':aid,'blocked':False,'response_identity_matches_self':str(data.get('user_id'))==str(me['id'])}
            except CanvasError as e:
                result={'source_course':a,'target_course':b,'assignment_id':aid,'blocked':str(e) in ('HTTP 404','HTTP 403'),'response':str(e)}
            report['cross_course'].append(result)
    report['request_count']=reader.requests
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',default='https://canvas.skku.edu')
    parser.add_argument('--env-file',type=Path)
    parser.add_argument('--term',required=True)
    parser.add_argument('--output',type=Path,default=Path('.local-review/canvas/student-qa.json'))
    args=parser.parse_args()
    if not args.output.resolve().is_relative_to(Path('.local-review').resolve()):
        parser.error('Personal results must be saved under .local-review/')
    os.umask(0o077)
    try:
        report=run(CanvasReader(args.base,token_from(args.env_file)),args.term)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False))
        return 1 if report['errors'] else 0
    except CanvasError as e:
        print(json.dumps({'error':str(e)},ensure_ascii=False))
        return 2

if __name__=='__main__':
    raise SystemExit(main())
