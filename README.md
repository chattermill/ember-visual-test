# ember-visual-test

Test screens in acceptance/integration tests for visual changes over time.

[![Ember Observer Score](https://emberobserver.com/badges/ember-visual-test.svg)](https://emberobserver.com/addons/ember-visual-test)
[![Build Status](https://travis-ci.org/Cropster/ember-visual-test.svg?branch=master)](https://travis-ci.org/Cropster/ember-visual-test)
[![npm version](https://badge.fury.io/js/ember-visual-test.svg)](https://badge.fury.io/js/ember-visual-test)

Compatibility
------------------------------------------------------------------------------

* Ember.js v3.4 or above
* Ember CLI v2.13 or above
* Node.js v8 or above


Installation
------------------------------------------------------------------------------

# Docs

[View the docs here](https://cropster.github.io/ember-visual-test/).

License
------------------------------------------------------------------------------

This project is licensed under the [MIT License](LICENSE.md).


## Notes
This is the fork, here is the [original implementation](https://github.com/Cropster/ember-visual-test).

It adds multiple features and removes few:
1. It allows you to configure screen size, just use `await capture(assert, 'some-page', { windowWidth: 1680, windowHeight: 1050 });` and it will create a screenshot for that screen size(output png file will have same size as all others)
2. Instead of `simple-headless-chrome` it uses `puppeteer`.
3. Here we have also removed imgur image upload, as we do not need it for our use case and we don't want to maintain not needed logic.