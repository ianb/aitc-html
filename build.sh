#!/usr/bin/env bash

set -e

help () {
    echo "Usage:"
    echo "  $(basename $0) { build | patch | makepatch }"
    echo "  build:     will build a servable-file from the modules in modules/"
    echo "  patch:     will rebuild the files in modules/ based on the patches in patches/"
    echo "  makepatch: will build a patch from the files in modules/"
}

run_build () {
    mkdir -p build build/ext
    for file in $(cd modules; find . -type f) ; do
        ./assemble_imports.py < modules/$file > build/$file
    done
}

run_patch () {
    for file in $(cat patches/FILES) ; do
	cat $SERVICES/$file | ./autofixup.py > modules/$file
    done
    ops=""
    for file in patches/*.patch ; do
	ops="$ops --input ../$file"
    done
    patch --directory modules/ $ops --strip 1
}

run_makepatch () {
    (
        cd modules
        rm ../patches/FILES
        for file in $(find . -type f) ; do
            if [ -e $SERVICES/$file ] ; then
                echo $file >> ../patches/FILES
            fi
        done
    )
    mkdir -p orig-modules
    mkdir -p orig-modules/ext
    for file in $(cat patches/FILES) ; do
	cat $SERVICES/$file | ./autofixup.py > orig-modules/$file
    done
    diff -u orig-modules modules > patches/files.patch
    rm -r orig-modules
}

if [ -z "$MOZ_CENTRAL" ] ; then
    echo "You must set \$MOZ_CENTRAL"
    echo "Probably point it to a checkout of:"
    echo "  https://github.com/mozilla-services/services-central.git"
    echo "Like:"
    echo "  git clone -b standalone-client https://github.com/mozilla-services/services-central.git"
    exit 1
fi

SERVICES="$MOZ_CENTRAL/services/sync/modules"

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
    *)
	echo "Error"
	help
	exit 2
	;;
esac
