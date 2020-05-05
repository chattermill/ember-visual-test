'use strict';

const path = require('path');
const fs = require('fs-extra');
const pixelmatch = require('pixelmatch');
const puppeteer = require('puppeteer');
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
    imageMatchAllowedFailures: 2,
    imageMatchThreshold: 0.3,
    imageLogging: true,
    debugLogging: true,
    includeAA: true,
    groupByOs: true,
    chromePort: 9222,
    windowWidth: 1440,
    windowHeight: 900,
    chromeFlags: [],
  },

  included(app) {
    this._super.included.apply(this, arguments);
    this._ensureThisImport();

    this._debugLog('Setting up ember-visual-test...');
    this._setupOptions(app.options.visualTest);

    this.import('vendor/visual-test.css', {
      type: 'test',
    });
  },

  async _getBrowser({ windowWidth, windowHeight }) {
    if (this.browser) {
      return this.browser;
    }

    const options = this.visualTest;

    // ensure only strings are used as flags
    let flags = options.chromeFlags.filter(
      (flag) => typeof flag === 'string' && flag
    );
    flags = this.setupFlags(flags);

    const width = windowWidth || options.windowWidth;
    const height = windowHeight || options.windowHeight;

    // This is started while the app is building, so we can assume this will be ready
    this._debugLog(`Browser: launching, size: height - ${height}, width: ${width}`);

    this.browser = await puppeteer.launch({
      headless: true,
      dumpio: true,
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width,
        height,
      },
      args: flags,
      userDataDir: null,
    });
    this._debugLog(
      `Chrome instance initialized with port=${this.browser.port}`
    );

    return this.browser;
  },

  setupFlags(flags) {
    if (!flags.includes('--headless')) flags.push('--headless');
    if (!flags.includes('--disable-dev-shm-usage')) flags.push('--disable-dev-shm-usage');
    if (!flags.includes('--disable-gpu')) flags.push('--disable-gpu');
    if (!flags.includes('--disable-software-rasterizer')) flags.push('--disable-software-rasterizer');
    if (!flags.includes('--mute-audio')) flags.push('--mute-audio');
    if (!flags.includes('--remote-debugging-port=0')) flags.push('--remote-debugging-port=0');
    if (!flags.includes('--window-size=1440,900')) flags.push('--window-size=1440,900');
    if (!flags.includes('--enable-logging')) flags.push('--enable-logging');
    if (!flags.includes('--start-maximized')) flags.push('--start-maximized');
    if (!flags.includes('--no-sandbox')) flags.push('--no-sandbox');
    if (!flags.includes('-–disable-setuid-sandbox')) flags.push('-–disable-setuid-sandbox');
    if (!flags.includes('--disable-web-security')) flags.push('--disable-web-security');
    if (!flags.includes('--allow-running-insecure-content')) flags.push('--allow-running-insecure-content');
    if (!flags.includes('--ignore-certificate-errors')) flags.push('--ignore-certificate-errors');
  },

  async _getBrowserPage({ windowWidth, windowHeight }) {
    const browser = await this._getBrowser({ windowWidth, windowHeight });
    const page = await browser.newPage();
    page.setDefaultTimeout(60 * 1000);

    page.once('load', () => {
      this._debugLog('Page: loaded');
    });

    page.on('console', message =>
      this._debugLog(`Browser log: ${message.type().substr(0, 3).toUpperCase()} ${message.text()}`)
    ).on('pageerror', ({ message }) =>
      this._debugLog(`Browser pageerror: ${message}`)
    ).on('response', response =>
      this._debugLog(`Browser response: ${response.status()} ${response.url()}`)
    ).on('requestfailed', request =>
      this._debugLog(`Browser requestfailed: ${request.failure().errorText} ${request.url()}`)
    );

    this._debugLog('Page: returned');
    return page;
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

  async _makeScreenshots(
    url,
    fileName,
    { fullPage, delayMs, windowWidth, windowHeight }
  ) {
    const options = this.visualTest;
    let page;

    try {
      page = await this._getBrowserPage({ windowWidth, windowHeight });
    } catch (e) {
      logError('Error: launching browser!');
      logError(e);
      return { newBaseline: false, chromeError: true };
    }

    try {
      await page.goto(url);
    } catch (e) {
      logError('Error: opening or resizing page');
      logError(e);
    }

    // This is inserted into the DOM by the capture helper when everything is ready
    await page.waitForSelector('#visual-test-has-loaded');
    this._debugLog('Page: selector exist');

    const fullPath = `${path.join(options.imageDirectory, fileName)}.png`;
    const screenshotOptions = {
      fullPage,
      type: 'png',
    };

    // To avoid problems...
    await page.waitFor(delayMs);
    this._debugLog('Page: awaited random time');
    this._debugLog(
      `Screenshot: params are - ${JSON.stringify(screenshotOptions, null, 2)}`
    );

    // only if the file does not exist, or if we force to save, do we write the actual images themselves
    const newBaseline = !fs.existsSync(fullPath);
    if (newBaseline) {
      this._imageLog(`Screenshot: making base screen ${fileName}`);

      await page.screenshot(
        Object.assign({}, screenshotOptions, {
          path: fullPath,
        })
      );
    }

    // Always make the tmp screenshot
    const fullTmpPath = `${path.join(options.imageTmpDirectory, fileName)}.png`;
    this._imageLog(`Screenshot: making comparison screen ${fileName}`);
    await page.screenshot(
      Object.assign({}, screenshotOptions, {
        path: fullTmpPath,
      })
    );

    this._debugLog('Screenshot: both generated');

    try {
      await page.close();
      this._debugLog('Page: closing');
    } catch (e) {
      logError('Error: closing a tab');
      logError(e);
    }

    return { newBaseline };
  },

  _compareImages(fileName) {
    const options = this.visualTest;
    const _this = this;

    if (!fileName.includes('.png')) {
      fileName = `${fileName}.png`;
    }

    const baselineImgPath = path.join(options.imageDirectory, fileName);
    const imgPath = path.join(options.imageTmpDirectory, fileName);

    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async function (resolve) {
      const baseImg = fs
        .createReadStream(baselineImgPath)
        .pipe(new PNG())
        .on('parsed', doneReading);

      const tmpImg = fs
        .createReadStream(imgPath)
        .pipe(new PNG())
        .on('parsed', doneReading);

        let filesRead = 0;

      async function doneReading() {
        if (++filesRead < 2) {
          return;
        }

        try {
          const diff = new PNG({ width: baseImg.width, height: baseImg.height });
          const errorPixelCount = pixelmatch(
            baseImg.data,
            tmpImg.data,
            diff.data,
            baseImg.width,
            baseImg.height,
            {
              threshold: options.imageMatchThreshold,
              includeAA: options.includeAA,
            }
          );

          if (errorPixelCount <= options.imageMatchAllowedFailures) {
            return resolve();
          }

          const diffPath = path.join(options.imageDiffDirectory, fileName);

          await fs.outputFile(diffPath, PNG.sync.write(diff));

          _this._debugLog('Compare: images generated');
        } catch (e) {
          _this._debugLog('Compare: tried to, got error');
          _this._debugLog(e);
        }
      }
    });
  },

  middleware(app) {
    app.use(
      bodyParser.urlencoded({
        limit: '50mb',
        extended: true,
        parameterLimit: 500000,
      })
    );
    app.use(
      bodyParser.json({
        limit: '50mb',
      })
    );

    app.post('/visual-test/make-screenshot', (req, res) => {
      const { url } = req.body;
      const fileName = this._getFileName(req.body.name);
      let { fullPage = false } = req.body;
      const delayMs = req.body.delayMs ? parseInt(req.body.delayMs) : 100;
      const windowHeight = req.body.windowHeight
        ? parseInt(req.body.windowHeight)
        : null;
      const windowWidth = req.body.windowWidth
        ? parseInt(req.body.windowWidth)
        : null;

      const params = {
        url,
        fileName,
        fullPage,
        delayMs,
        windowWidth,
        windowHeight,
      };

      this._debugLog(
        `Screenshot: posting with the options ${JSON.stringify(params, null, 2)}`
      );

      const data = {};
      this._makeScreenshots(url, fileName, {
        fullPage,
        delayMs,
        windowWidth,
        windowHeight,
      })
        .then(({ newBaseline }) => {
          data.newBaseline = newBaseline;

          return this._compareImages(fileName);
        })
        .then(() => {
          data.status = 'SUCCESS';

          this._debugLog('images succeeded, all good');

          res.send(data);
        })
        .catch(reason => {
          this._debugLog(`Screenshot: catched, reason: ${reason}`);
          const diffPath = reason ? reason.diffPath : null;
          const tmpPath = reason ? reason.tmpPath : null;
          const errorPixelCount = reason ? reason.errorPixelCount : null;
          this._debugLog('images failed, something went wrong');

          data.status = 'ERROR';
          data.diffPath = diffPath;
          data.fullDiffPath = path.join(__dirname, diffPath);
          data.error = `${errorPixelCount} pixels differ - diff: ${diffPath}, img: ${tmpPath}`;

          res.send(data);
        });
    });
  },

  testemMiddleware(app) {
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
