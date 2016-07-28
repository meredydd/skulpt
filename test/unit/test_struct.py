__author__ = 'Meredydd Luff'

import unittest
import struct

class StructTestCase(unittest.TestCase):

    def test_round_trip(self):
        t = struct.pack('Bf',1,2.5)
        self.assertEqual(len(t), 8);
        self.assertEqual(struct.calcsize('Bf'), 8)
        self.assertEqual(struct.unpack('Bf', t), (1,2.5))

if __name__ == '__main__':
    unittest.main()
