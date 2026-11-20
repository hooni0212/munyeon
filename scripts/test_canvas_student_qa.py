import unittest
from canvas_student_qa import CanvasReader, CanvasError, NoRedirect

class CanvasReaderSecurityTests(unittest.TestCase):
    def setUp(self):
        self.reader = CanvasReader('https://canvas.example.test', 'synthetic-token')

    def test_only_expected_https_read_endpoints(self):
        for path in ['/api/v1/courses', '/api/v1/courses/12/assignments?per_page=100', '/api/v1/courses/12/assignments/30/submissions/self']:
            self.reader.validate(path)
        for path in ['http://canvas.example.test/api/v1/courses', 'https://attacker.invalid/api/v1/courses', '//attacker.invalid/api/v1/courses', 'https://user:pass@canvas.example.test/api/v1/courses', '/api/v1/courses/12/users', '/api/v1/courses/12/assignments/30/submissions/999']:
            with self.subTest(path=path), self.assertRaises(CanvasError):
                self.reader.validate(path)

    def test_redirect_never_replays_bearer(self):
        with self.assertRaises(CanvasError):
            NoRedirect().redirect_request(None,None,302,'',{},'https://attacker.invalid')

    def test_hostile_pagination_rejected_before_next_request(self):
        calls=[]
        def fake(path):
            calls.append(path)
            return [], '<https://attacker.invalid/api/v1/courses>; rel="next"'
        self.reader.get=fake
        with self.assertRaises(CanvasError):
            self.reader.pages('/api/v1/courses')
        self.assertEqual(len(calls),1)

    def test_pagination_cycle_stops(self):
        self.reader.get=lambda path: ([], '<https://canvas.example.test/api/v1/courses>; rel="next"')
        with self.assertRaises(CanvasError):
            self.reader.pages('/api/v1/courses')

if __name__=='__main__': unittest.main()
