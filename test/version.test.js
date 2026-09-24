'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SnakeVersion = require('../js/version.js');

test('APP_VERSION is the current release', () => {
    assert.equal(SnakeVersion.APP_VERSION, '11');
});

test('displayText renders the header label', () => {
    assert.equal(SnakeVersion.displayText(), 'v11');
});

test('exposes a browser global', () => {
    assert.equal(globalThis.SnakeVersion, SnakeVersion);
});
