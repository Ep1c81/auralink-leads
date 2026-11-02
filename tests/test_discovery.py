import unittest
from unittest.mock import Mock
from tempfile import TemporaryDirectory
from discovery_engine_osm import normalize_element, discover
class DiscoveryTests(unittest.TestCase):
    def test_branches_and_coordinates(self):
        a=normalize_element({'id':1,'type':'node','lat':9.9,'lon':-84.1,'tags':{'name':'Cadena'}})
        b=normalize_element({'id':2,'type':'way','center':{'lat':9.8,'lon':-84.2},'tags':{'name':'Cadena'}})
        self.assertNotEqual(a['source_key'],b['source_key'])
        self.assertEqual(b['latitude'],9.8)
        self.assertIsNone(a['website'])
    def test_no_embedded_credentials(self):
        from pathlib import Path
        import re
        for filename in ('discovery_engine.py','generate_outreach.py','src/qualify_leads.py'):
            text=Path(filename).read_text()
            self.assertIsNone(re.search(r'AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.',text))
    def test_malformed(self):
        self.assertIsNone(normalize_element({'id':'bad','type':'node'}))
    def test_429_checkpoint(self):
        session=Mock();response=Mock();response.status_code=429;response.headers={'Retry-After':'120'}
        session.post.return_value.__enter__=Mock(return_value=response);session.post.return_value.__exit__=Mock(return_value=False)
        with TemporaryDirectory() as directory:
            with self.assertRaises(RuntimeError):discover([9.9,-84.2,10,-84.1],'cafe',directory,session)
            from pathlib import Path
            self.assertEqual(len(list(Path(directory).glob('*.json'))),1)
if __name__=='__main__':unittest.main()
