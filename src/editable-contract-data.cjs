'use strict';

function fail(path, message) {
  throw Object.assign(new Error(`${path}: ${message}`), { code: 'EDITABLE_CONTRACT_INVALID', path });
}

// Accept JSON data only. Reject lossy serialization (holes, accessors, undefined,
// non-finite numbers, custom prototypes, symbols, cycles) before reading fields.
// Sorted object keys make serialization independent of property insertion order.
function jsonSnapshot(value, path = '$', ancestors = new Set(), depth = 0) {
  if (depth > 32) fail(path, 'Contract nesting exceeds 32 levels.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value)) {
      fail(path, 'Invalid Unicode text.');
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) fail(path, 'Expected acyclic JSON data.');
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)
    && !(Object.getPrototypeOf(value) === null && !array)) fail(path, 'Expected plain JSON data.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter((key) => !(array && key === 'length'));
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(path, 'Only enumerable data properties are allowed.');
    }
  }
  if (array && (keys.length !== value.length
    || keys.some((key, index) => key !== String(index)))) fail(path, 'Expected a dense JSON array.');
  ancestors.add(value);
  const result = array ? [] : {};
  for (const key of array ? keys : keys.sort()) {
    Object.defineProperty(result, key, {
      value: jsonSnapshot(descriptors[key].value, `${path}.${key}`, ancestors, depth + 1),
      enumerable: true, writable: true, configurable: true
    });
  }
  ancestors.delete(value);
  return result;
}

function fields(value, names, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== names.length
    || names.some((name) => !Object.hasOwn(value, name))) fail(path, `Expected exactly: ${names.join(', ')}.`);
}
function string(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'Expected nonempty text.');
}
function id(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) fail(path, 'Invalid stable identity.');
}
function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail(path, 'Expected a positive safe integer.');
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

module.exports = { fail, jsonSnapshot, fields, string, id, positiveInteger, deepFreeze };
