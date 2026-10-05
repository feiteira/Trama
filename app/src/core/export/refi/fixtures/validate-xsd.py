"""Validates XML files against an XSD with lxml. Used by the REFI-QDA tests.

usage: validate-xsd.py SCHEMA.xsd FILE.xml [FILE.xml ...]
Prints "ok" or the validation errors; exits 0 when every file is valid.
"""
import sys

from lxml import etree

schema = etree.XMLSchema(etree.parse(sys.argv[1]))
failed = False
for path in sys.argv[2:]:
    doc = etree.parse(path)
    if not schema.validate(doc):
        failed = True
        for err in schema.error_log:
            print(f"{path}:{err.line}: {err.message}")
if not failed:
    print("ok")
sys.exit(1 if failed else 0)
