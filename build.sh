#!/usr/bin/env bash

set -e
#set -x

help () {
    echo "Usage:"
    echo "  $(basename $0) { build | patch | makepatch }"
    echo "  build:     will build a servable-file from the modules in modules/"
    echo "  patch:     will rebuild the files in modules/ based on the patches in patches/"
    echo "  makepatch: will build a patch from the files in modules/"
    echo "  check:     will check files in modules/ for syntax, etc"
}

make_parent () {
    mkdir -p "$(dirname $1)"
}

get_lines () {
    python -c '
import sys
fp = open(sys.argv[1])
for line in fp:
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    print line
' "$1"
}

run_build () {
    mkdir -p build build/ext
    for file in $(cd modules; find . -name '*.js' ! -path '*/tests/*') ; do
        echo "Building modules/$file to build/$file"
        make_parent build/$file
        ./assemble_imports.py < modules/$file > build/$file
    done
}

run_patch () {
    for file in $(get_lines patches/FILES) ; do
        make_parent modules/$file
	cat $SERVICES/$file | ./autofixup.py > modules/$file
    done
    ops=""
    for file in patches/*.patch ; do
	ops="$ops --input ../$file"
    done
    patch --directory modules/ $ops --strip 1
}

run_makepatch () {
    for file in $(get_lines patches/FILES) ; do
        make_parent orig-modules/$file
	cat $SERVICES/$file | ./autofixup.py > orig-modules/$file
    done
    diff --recursive -w -u orig-modules modules > patches/files.patch
    #rm -r orig-modules
}

run_check () {
    ops=""
    for file in $(find modules/ -type f -name '*.js') ; do
        ops="$ops -process $file"
    done
    jsl -nologo -conf jslint.conf $ops
}

if [ -z "$MOZ_CENTRAL" ] ; then
    echo "You must set \$MOZ_CENTRAL"
    echo "Probably point it to a checkout of:"
    echo "  https://hg.mozilla.org/services/services-central"
    exit 1
fi

SERVICES="$MOZ_CENTRAL/services"

if [ "$1" = "-h" ] || [ -z "$1" ] ; then
    help
    exit
fi

case "$1" in
    build)
	run_build
	;;
    patch)
	run_patch
	;;
    makepatch)
	run_makepatch
	;;
    check)
        run_check
        ;;
    *)
	echo "Error"
	help
	exit 2
	;;
esac
