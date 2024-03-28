#!/bin/bash
# Builds prod versions of the web app and deploys to app.electrifygame.com, including invalidating the files on cloudfront (CDN)

# Requires the aws cli for s3 deploys (make sure to set your bucket region!)
# Requires that you run `aws configure set preview.cloudfront true` to enable cloudfront invalidation

prebuild() {
  # clear out old build files to prevent conflicts
  rm -rf www
}

betabuild() {
  prebuild
  export NODE_ENV='dev'
  echo "NOPE"
  npm run build
}

beta() {
  betabuild
  aws s3 cp www s3://beta.electrifygame.com --recursive --region us-east-2
}

prodbuild() {
  prebuild

  # Read current version (as a string) from package.json
  key="version"
  re="\"($key)\": \"([^\"]*)\""
  package=`cat package.json`
  if [[ $package =~ $re ]]; then
    version="${BASH_REMATCH[2]}"
  fi

  # Rebuild the web app files
  export NODE_ENV='production'
  export OAUTH2_CLIENT_ID='545484140970-r95j0rmo8q1mefo0pko6l3v6p4s771ul.apps.googleusercontent.com'
  
  # build the web app
  webpack --config ./webpack.dist.config.js
}

prod() {
  prodbuild
  # Deploy web app to prod with 1 day cache for most files, 6 month cache for art assets
  export AWS_DEFAULT_REGION='us-east-2'
  aws s3 cp www s3://electrifygame.com --recursive --exclude '*.mp3' --exclude '*.jpg' --exclude '*.png' --cache-control max-age=86400 --cache-control public
  aws s3 cp www s3://electrifygame.com --recursive --exclude '*' --include '*.mp3' --include '*.jpg' --include '*.png' --cache-control max-age=15552000 --cache-control public

  # Upload package.json for API's version check
  aws s3 cp package.json s3://electrifygame.com/package.json

  # Invalidate files on cloudfront
  aws cloudfront create-invalidation --distribution-id E38D57AILAHD00 --paths /\*
}

# Calls arguments verbatim, aka arg -> function
"$@"
