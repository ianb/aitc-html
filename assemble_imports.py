#!/usr/bin/env python

import os
import posixpath
import re
import sys
import json

here = os.path.dirname(os.path.abspath(__file__))

import_re = re.compile(r'C.*?\.import\(["' + "'" + r'](.*?)["' + "'" + r']\);')


JS_TEMPLATE = """\
%(requires)s

(function (exports) {

%(body)s

// Import wrapper:
for (var _i=0; _i<EXPORTED_SYMBOLS.length; _i++) {
  exports[EXPORTED_SYMBOLS[_i]] = eval(EXPORTED_SYMBOLS[_i]);
}

})(window);
"""


def rewrite_file(content):
    requires = []

    def import_repl(match):
        url = match.group(1)
        filename = posixpath.basename(url)
        requires.append('// @require "%s"' % filename)
        return ''
    new_content = import_re.sub(import_repl, content)
    new_content = JS_TEMPLATE % dict(
        body=new_content,
        requires='\n'.join(requires),
        )
    return new_content


def main():
    if '-h' in sys.argv[1:]:
        print 'Usage:'
        print '  assemble_imports.py < INPUT_FILE > OUTPUT_FILE'
        sys.exit()
    sys.stdout.write(rewrite_file(sys.stdin.read()))


if __name__ == '__main__':
    main()
