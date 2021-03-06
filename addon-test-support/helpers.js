import { dasherize } from '@ember/string';
import RSVP from 'rsvp';

const isObject = data => Object.prototype.toString.call(data).slice(8, -1).toLowerCase();

/**
 * Capture a screenshot of the current page.
 * This works in both acceptance tests as well as in integration tests.
 *
 * ```
 * import capture from 'ember-visual-test/test-support/helpers';
 *
 * await capture(assert, 'unique-name');
 * ```
 *
 *
 * @function capture
 * @param {Object} assert The assert function. This assumes you are using qunit.
 * @param {string} fileName  A unique string to identify this capture. This will be the file name of the generated images, and has to be unique across your whole application. If it contains '/', subdirectories will be created so you can group baseline images.
 * @param {Object} [options] An optional object with options. The following options are allowed:
 * @param {string} [options.selector] An optional selector to screenshot. If not specified, the whole page will be captured.
 * @param {boolean} [options.fullPage] If a full page screenshot should be made, or just the browsers viewport. Defaults to `true`
 * @param {integer} [options.delayMs] Delay (in milliseconds) before taking the screenshot. Useful when you need to wait for CSS transitions, etc. Defaults to `100`.
 * @return {Promise}
 */
export async function capture(assert, fileName, {
  selector = null,
  fullPage = true,
  delayMs = 100,
  windowWidth,
  windowHeight
} = {}) {
  const { testId } = assert.test;

  const queryParamString = window.location.search.substr(1);
  const queryParams = queryParamString.split('&');

  // If is in capture mode, set the capture up & stop the tests
  if (queryParams.includes('capture=true')) {
    // If it is not the current test, skip...
    // Otherwise, it would be impossible to have multiple captures in one test
    if (!queryParams.includes(`fileName=${fileName}`)) {
      return;
    }

    prepareCaptureMode();

    // Wait forever
    assert.async();
    return new RSVP.Promise(() => {
      // Never resolve this...
    });
  }

  // If not in capture mode, make a request to the middleware to capture a screenshot in node
  const urlQueryParams = [
    `testId=${testId}`,
    'devmode',
    `fileName=${fileName}`,
    'capture=true'
  ];

  const url = `${window.location.protocol}//${window.location.host}${
    window.location.pathname
  }?${urlQueryParams.join('&')}`;

  let response = await requestCapture(url, fileName, {
    selector,
    fullPage,
    delayMs,
    windowWidth,
    windowHeight
  });

  if (response.status === 'SUCCESS') {
    assert.ok(true, `visual-test: ${fileName} has not changed`);
  } else {
    assert.ok(false, `visual-test: ${fileName} has changed: ${response.error}`);
  }

  return response;
}

export function prepareCaptureMode() {
  // Add class for capture
  document.body.classList.add('visual-test-capture-mode');

  const event = new CustomEvent('pageLoaded');
  window.dispatchEvent(event);

  // Put this into the dom to make headless chrome aware that rendering is complete
  if (!document.querySelector('#visual-test-has-loaded')) {
    const div = document.createElement('div');
    div.setAttribute('id', 'visual-test-has-loaded');
    document.body.appendChild(div);
  }
}

export async function requestCapture(url, fileName, {
  selector,
  fullPage,
  delayMs,
  windowWidth,
  windowHeight
}) {
  // If not in capture mode, make a request to the middleware to capture a screenshot in node
  const name = dasherize(fileName);

  const data = {
    url,
    name,
    selector,
    fullPage,
    delayMs,
    windowWidth,
    windowHeight,
  };

  return ajaxPost('/visual-test/make-screenshot', data, 'application/json');
}

export function ajaxPost(url, data, contentType = 'application/json') {
  const xhr = new XMLHttpRequest();

  return new RSVP.Promise((resolve, reject) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.onload = function() {
      const data = parseAjaxResponse(xhr.responseText);

      if (xhr.status === 200) return resolve(data);

      const message = isObject(data) ? JSON.stringify(data, null, 2) : data;
      console.log(`Couldn't post data, data is: ${message}`);
      reject(data);
    };
    xhr.send(JSON.stringify(data));
  });
}

function parseAjaxResponse(responseText) {
  let data = responseText;
  try {
    data = JSON.parse(data);
  } catch (e) {
    console.log('Got an error'); // eslint-disable-line
    console.log(e); // eslint-disable-line
  }
  return data;
}
