#!/bin/bash
# Builds the web app and deploys to electrifygame.com, including invalidating the files on cloudfront (CDN)
# Requires the aws cli for s3 deploys (make sure to set your bucket region!)
# Requires that you run `aws configure set preview.cloudfront true` to enable cloudfront invalidation

TARGETS="beta prod local-beta local-prod"
target="$1"

getTarget() {
  if [[ ! $TARGETS =~ $target ]];
  then
    echo "Where would you like to deploy?"
    select t in $TARGETS; do
      target=$t
      break
    done
  fi
}

deploy() {
  echo "Deploying to $target"
  if [ "$target" = "beta" ]; then
    beta
  elif [ "$target" = "local-beta" ]; then
    betabuild
  elif [ "$target" = "local-prod" ]; then
    prodbuild
  elif [ "$target" = "prod" ]; then
    read -p "Did you test on beta? (y/N) " -n 1
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      read -p "Are you on the master branch? (y/N) " -n 1
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        prod
      else
        echo "Prod build cancelled until on master branch."
      fi
    else
      echo "Prod build cancelled until tested on beta."
    fi
  else
    echo "Invalid target"
  fi
}

prebuild() {
  # clear out old build files to prevent conflicts
  rm -rf build
}

betabuild() {
  prebuild
  export NODE_ENV='development'
  npm run build
}

beta() {
  betabuild
  aws s3 cp build s3://beta.electrifygame.com --recursive --region us-east-2
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
  aws s3 cp build s3://electrifygame.com --recursive --exclude '*.mp3' --exclude '*.jpg' --exclude '*.png' --cache-control max-age=86400 --cache-control public
  aws s3 cp build s3://electrifygame.com --recursive --exclude '*' --include '*.mp3' --include '*.jpg' --include '*.png' --cache-control max-age=15552000 --cache-control public

  # Upload package.json for API's version check
  aws s3 cp package.json s3://electrifygame.com/package.json

  # Invalidate files on cloudfront
  aws cloudfront create-invalidation --distribution-id E38D57AILAHD00 --paths /\*
}

getTarget
deploy
