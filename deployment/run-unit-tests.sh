#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned。
# You can remove this script if you do NOT have unit test.
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./run-unit-tests.sh
#

# Get reference for all important folders
template_dir="$PWD"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "[Init] Clean old dist and node_modules folders"
echo "------------------------------------------------------------------------------"
echo "find $source_dir -iname "node_modules" -type d -exec rm -r "{}" \; 2> /dev/null"
find $source_dir/ -iname "node_modules" -type d -exec rm -r "{}" \; 2> /dev/null
echo "find ../ -type f -name 'package-lock.json' -delete"
find ../ -type f -name 'package-lock.json' -delete

echo "------------------------------------------------------------------------------"
echo "[Test] Services - Function"
echo "------------------------------------------------------------------------------"
cd $source_dir/
npm install
npm test
