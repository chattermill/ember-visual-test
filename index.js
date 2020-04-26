'use strict';

const path = require('path');
const fs = require('fs-extra');
const pixelmatch = require('pixelmatch');
const HeadlessChrome = require('simple-headless-chrome');
const os = require('os');

/* eslint-disable node/no-extraneous-require */
const bodyParser = require('body-parser');
const { PNG } = require('pngjs');
/* eslint-enable node/no-extraneous-require */

module.exports = {
  name: require('./package').name,

  // The base settings
  // This can be overwritten
  visualTest: {
    imageDirectory: 'visual-test-output/baseline',
    imageDiffDirectory: 'visual-test-output/diff',
    imageTmpDirectory: 'visual-test-output/tmp',
    forceBuildVisualTestImages: false,
    imageMatchAllowedFailures: 0,
    imageMatchThreshold: 0.3,
    imageLogging: false,
    debugLogging: false,
    includeAA: true,
    groupByOs: true,
    chromePort: 0,
    windowWidth: 1024,
    windowHeight: 768,
    noSandbox: false,
    chromeFlags: []
  },

  included(app) {
    this._super.included.apply(this, ...arguments);
    this._ensureThisImport();

    this._debugLog('Setting up ember-visual-test...');
    this._setupOptions(app.options.visualTest);

    this.import('vendor/visual-test.css', {
      type: 'test'
    });
  },

  async _getBrowser({ windowWidth, windowHeight }) {
    if (this.browser) {
      return this.browser;
    }

    const options = this.visualTest;

    // ensure only strings are used as flags
    const flags = options.chromeFlags.filter(flag => typeof flag === 'string' && flag);
    if (!flags.includes('--enable-logging')) {
      flags.push('--enable-logging');
    }

    if (!flags.includes('--start-maximized')) {
      flags.push('--start-maximized');
    }

    let { noSandbox } = options;
    if (process.env.CI) {
      noSandbox = true;
    }

    this.browser = new HeadlessChrome({
      headless: true,
      chrome: {
        flags,
        port: options.port || options.chromePort,
        userDataDir: null,
        noSandbox
      },
      browserlog: true,
      browserLog: true,
      deviceMetrics: {
        width: windowWidth || options.windowWidth,
        height: windowHeight || options.windowHeight,
      },
      browser: {
        browserLog: options.debugLogging
      }
    });

    // This is started while the app is building, so we can assume this will be ready
    this._debugLog('Starting chrome instance...');
    await this.browser.init();
    this._debugLog(`Chrome instance initialized with port=${this.browser.port}`);

    return this.browser;
  },

  async _getBrowserTab({ windowWidth, windowHeight }) {
    const browser = await this._getBrowser({ windowWidth, windowHeight });
    const tab = await browser.newTab({ privateTab: false });

    tab.onConsole(options => {
      const logValue = options.map((item) => item.value).join(' ');
      this._debugLog(`Browser log: ${logValue}`);
    });

    return tab;
  },

  _imageLog(str) {
    if (this.visualTest.imageLogging) {
      log(str);
    }
  },

  _debugLog(str) {
    if (this.visualTest.debugLogging) {
      log(str);
    }
  },

  async _makeScreenshots(url, fileName, { selector, fullPage, delayMs, windowWidth, windowHeight }) {
    const options = this.visualTest;
    let tab;

    try {
      tab = await this._getBrowserTab({ windowWidth, windowHeight });
    } catch (e) {
      logError('Error when launching browser!');
      logError(e);
      return { newBaseline: false, chromeError: true };
    }

    try {
      await tab.goTo(url);
      await tab.resizeFullScreen();
    } catch (e) {
      logError('Error opening or resizing pages');
      logError(e);
    }

    // This is inserted into the DOM by the capture helper when everything is ready
    await tab.waitForSelectorToLoad('#visual-test-has-loaded', { interval: 1000 });

    const fullPath = `${path.join(options.imageDirectory, fileName)}.png`;
    const screenshotOptions = { selector, fullPage };

    // To avoid problems...
    await tab.wait(delayMs);

    // only if the file does not exist, or if we force to save, do we write the actual images themselves
    const newBaseline = options.forceBuildVisualTestImages || !fs.existsSync(fullPath);
    if (newBaseline) {
      this._imageLog(`Making base screenshot ${fileName}`);

      await fs.outputFile(fullPath, await tab.getScreenshot(screenshotOptions, true));
    }

    // Always make the tmp screenshot
    const fullTmpPath = `${path.join(options.imageTmpDirectory, fileName)}.png`;
    this._imageLog(`Making comparison screenshot ${fileName}`);
    await fs.outputFile(fullTmpPath, await tab.getScreenshot(screenshotOptions, true));

    try {
      await tab.close();
    } catch(e) {
      logError('Error closing a tab...');
      logError(e);
    }

    return { newBaseline };
  },

  _compareImages(fileName) {
    const options = this.visualTest;

    if (!fileName.includes('.png')) {
      fileName = `${fileName}.png`;
    }

    const baselineImgPath = path.join(options.imageDirectory, fileName);
    const imgPath = path.join(options.imageTmpDirectory, fileName);

    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async function(resolve) {
      const baseImg = fs.createReadStream(baselineImgPath).pipe(new PNG()).on('parsed', doneReading);
      const tmpImg = fs.createReadStream(imgPath).pipe(new PNG()).on('parsed', doneReading);
      let filesRead = 0;

      async function doneReading() {
        if (++filesRead < 2) {
          return;
        }

        const diff = new PNG({ width: baseImg.width, height: baseImg.height });
        const errorPixelCount = pixelmatch(baseImg.data, tmpImg.data, diff.data, baseImg.width, baseImg.height, {
          threshold: options.imageMatchThreshold,
          includeAA: options.includeAA
        });

        if (errorPixelCount <= options.imageMatchAllowedFailures) {
          return resolve();
        }

        const diffPath = path.join(options.imageDiffDirectory, fileName);

        await fs.outputFile(diffPath, PNG.sync.write(diff));
      }
    });
  },

  middleware(app) {
    app.use(bodyParser.urlencoded({
      limit: '5mb',
      extended: true,
      parameterLimit: 5000
    }));
    app.use(bodyParser.json({
      limit: '5mb'
    }));

    app.post('/visual-test/make-screenshot', (req, res) => {
      const {
        url,
        selector,
      } = req.body;
      const fileName = this._getFileName(req.body.name);
      let { fullPage = false } = req.body;
      const delayMs = req.body.delayMs ? parseInt(req.body.delayMs) : 100;
      const windowHeight = req.body.windowHeight ? parseInt(req.body.windowHeight) : null;
      const windowWidth = req.body.windowWidth ? parseInt(req.body.windowWidth) : null;

      if (fullPage === 'true') {
        fullPage = true;
      }
      if (fullPage === 'false') {
        fullPage = false;
      }

      const data = {};
      this._makeScreenshots(url, fileName, {
        selector,
        fullPage,
        delayMs,
        windowWidth,
        windowHeight
      }).then(({
        newBaseline
      }) => {

        data.newBaseline = newBaseline;

        return this._compareImages(fileName);
      }).then(() => {
        data.status = 'SUCCESS';
        res.send(data);
      }).catch(reason => {
        const diffPath = reason ? reason.diffPath : null;
        const tmpPath = reason ? reason.tmpPath : null;
        const errorPixelCount = reason ? reason.errorPixelCount : null;

        data.status = 'ERROR';
        data.diffPath = diffPath;
        data.fullDiffPath = path.join(__dirname, diffPath);
        data.error = `${errorPixelCount} pixels differ - diff: ${diffPath}, img: ${tmpPath}`;

        res.send(data);
      });
    });
  },

  testemMiddleware(app) {
    const visualTest = this.project.config('test').visualTest;
    this._setupOptions(visualTest);
    this.middleware(app);
  },

  serverMiddleware(options) {
    this.app = options.app;
    this.middleware(options.app);
  },

  _ensureThisImport() {
    if (!this.import) {
      this._findHost = function findHostShim() {
        let current = this;
        let app;
        do {
          app = current.app || app;
        } while (current.parent.parent && (current = current.parent));
        return app;
      };
      this.import = function importShim(asset, options) {
        const app = this._findHost();
        app.import(asset, options);
      };
    }
  },

  _getFileName(fileName) {
    const options = this.visualTest;

    if (options.groupByOs) {
      const os = options.os;

      const filePath = path.parse(fileName);

      filePath.name = `${os}-${filePath.name}`;
      delete filePath.base;

      return path.format(filePath);
    }
    return fileName;
  },

  isDevelopingAddon() {
    return false;
  },

  _setupOptions(visualTest) {
    const options = Object.assign({}, this.visualTest, visualTest);
    options.forceBuildVisualTestImages = !!process.env.FORCE_BUILD_VISUAL_TEST_IMAGES;
    this.visualTest = options;

    let osType = os.type().toLowerCase();
    switch (osType) {
      case 'windows_nt':
        osType = 'win';
        break;
      case 'darwin':
        osType = 'mac';
        break;
    }
    options.os = osType;
  },
};

function log() {
  // eslint-disable-next-line no-console
  console.log(...arguments);
}

function logError() {
  // eslint-disable-next-line no-console
  console.error(...arguments);
}
