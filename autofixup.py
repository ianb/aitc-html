#!/usr/bin/env python

import re
import sys


subs = [
    (r'let(\s+)', r'var\1'),
    ]


comment_re = re.compile(r'(?:/\*.*?\*/|\n\s*//.*?\n)')


def rewrite(js):
    result = []
    rest = js
    while 1:
        match = comment_re.search(rest)
        if not match:
            result.append(rewrite_section(rest))
            break
        result.append(rewrite_section(rest[:match.start()]))
        result.append(match.group(0))
        rest = rest[match.end():]
    return ''.join(result)


def rewrite_section(part):
    for expr, repl in subs:
        part = re.sub(expr, repl, part)
    return part


def main():
    sys.stdout.write(rewrite(sys.stdin.read()))


if __name__ == '__main__':
    main()
