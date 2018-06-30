import fs from 'fs';
import { promisify } from 'es6-promisify';
import { parseString } from 'xml2js';
import fetch from 'node-fetch';
import tmp from 'tmp';
import reduce from 'lodash.reduce';
import camelcase from 'lodash.camelcase';
import _debug from 'debug';
import discover from './discover';
import Commander from './commander';

const debug = _debug('roku-client:client');

const parseStringAsync = promisify(parseString);

/**
 * The properties associated with a Roku app.
 * @typedef {Object} App
 * @property {string} id The id, used within the api.
 * @property {string} name The display name of the app.
 * @property {string} type The app type (channel, application, etc).
 * @property {string} version The app version.
 */

/**
 * Return a promise of the parsed fetch response xml.
 * @param {Promise} res A fetch response object.
 * @return {Promise}
 */
function parseXML(res) {
  if (!res.ok) {
    throw new Error(`Request failed: ${res.statusText}`);
  }
  return res.text()
    .then(parseStringAsync);
}

/**
 * Convert the xml version of a roku app
 * to a cleaned up js version.
 * @param {Object} app
 * @return {App}
 */
function appXMLToJS(app) {
  const { _: name } = app;
  const { id, type, version } = app.$;
  return {
    id,
    name,
    type,
    version,
  };
}

/**
 * The Roku client class. Contains methods to talk to a roku device.
 */
export default class Client {
  /**
   * Return a new `Client` object for the first Roku device discovered
   * on the network. This method resolves to a single `Client` object.
   * If multiple Roku devices exist on the network, import `discover`
   * directly and call it with `wait` set to true, and then initialize a
   * `Client` object for each address in the returned array.
   * @param {number=} timeout The time in ms to wait before giving up.
   * @return {Promise<Client>} A `Client` object.
   */
  static discover(timeout) {
    return discover(timeout).then(ip => new Client(ip));
  }

  /**
   * Construct a new `Client` object with the given address.
   * @param {string} ip The address of the Roku device on the network.
   */
  constructor(ip) {
    this.ip = ip;
  }

  /**
   * Get a list of apps installed on this device.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-query/apps}
   * @return {Promise<App[]>}
   */
  apps() {
    const endpoint = `${this.ip}/query/apps`;
    debug(`GET ${endpoint}`);
    return fetch(endpoint)
      .then(parseXML)
      .then(({ apps }) => apps.app.map(appXMLToJS));
  }

  /**
   * Get the active app, or null if the home screen is displayed.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-query/active-app}
   * @return {Promise<App|null>}
   */
  active() {
    const endpoint = `${this.ip}/query/active-app`;
    debug(`GET ${endpoint}`);
    return fetch(endpoint)
      .then(parseXML)
      .then((data) => {
        const { app } = data['active-app'];
        if (app.length !== 1) {
          throw new Error(`expected 1 active app but received ${app.length}: ${app}`);
        }
        const activeApp = app[0];
        // If no app is currently active, a single field is returned without
        // any properties
        if (!activeApp.$ || !activeApp.$.id) {
          return null;
        }
        return appXMLToJS(activeApp);
      });
  }

  /**
   * Get the info of this Roku device. Responses vary between devices.
   * All keys are coerced to camelcase for easier access, so user-device-name
   * becomes userDeviceName, etc.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-query/device-info}
   * @return {Promise<Object>}
   */
  info() {
    const endpoint = `${this.ip}/query/device-info`;
    debug(`GET ${endpoint}`);
    return fetch(endpoint)
      .then(parseXML)
      .then(data => reduce(data['device-info'], (result, [value], key) =>
        Object.assign({}, result, { [camelcase(key)]: value }), {}));
  }

  /**
   * Download the given app's icon to the tmp directory and return that location.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-query/icon/appID}
   * @param {number|string} appId The app id to get the icon of.
   *     Should be the id from the id field of the app.
   * @return {Promise<string>} The temporary path to the image.
   */
  icon(appId) {
    const endpoint = `${this.ip}/query/icon/${appId}`;
    debug(`GET ${endpoint}`);
    return fetch(endpoint)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch icon for app ${appId}: ${res.statusText}`);
        }

        return new Promise((resolve, reject) => {
          const type = res.headers.get('content-type');
          const [, ext] = /image\/(.*)/.exec(type);
          tmp.file({ keep: true, postfix: `.${ext}` }, (err, path, fd) => {
            if (err) {
              reject(err);
              return;
            }
            const dest = fs.createWriteStream(null, { fd });
            res.body.pipe(dest);
            resolve(path);
          });
        });
      });
  }

  /**
   * Launch the given `appId`.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-launch/appID}
   * @param {number|string} appId The id of the app to launch.
   * @return {Promise}
   */
  launch(appId) {
    const endpoint = `${this.ip}/launch/${appId}`;
    debug(`POST ${endpoint}`);
    return fetch(endpoint, { method: 'POST' })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to call ${endpoint}: ${res.statusText}`);
        }
      });
  }

  /**
   * Launch the DTV tuner, optionally with a channel number
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-launch/tvinput.dtv}
   * @param {number|string} appId The id of the app to launch.
   * @return {Promise}
   */
  launchDtv(channel) {
    const channelQuery = channel ? `?ch=${channel}` : '';
    const endpoint = `${this.ip}/launch/tvinput.dtv${channelQuery}`;
    debug(`POST ${endpoint}`);
    return fetch(endpoint, { method: 'POST' })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to call ${endpoint}: ${res.statusText}`);
        }
      });
  }


  /**
   * Helepr used by all keypress methods. Converts single characters
   * to `Lit_` commands to send the letter to the Roku.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-KeypressKeyValues}
   * @api private
   * @param {string} func The name of the Roku endpoint function.
   * @param {string} key The key to press.
   * @return {Promise<null>}
   */
  keyhelper(func, key) {
    // if a single key is sent, treat it as a letter
    if (key.length === 1) {
      key = `Lit_${encodeURIComponent(key)}`; // eslint-disable-line no-param-reassign
    }
    const endpoint = `${this.ip}/${func}/${key}`;
    debug(`POST ${endpoint}`);
    return fetch(endpoint, { method: 'POST' })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to call ${endpoint}: ${res.statusText}`);
        }
      });
  }

  /**
   * Equivalent to pressing and releasing the remote control key given.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-keypress/key}
   * @param {string} key A key from the keys module.
   * @return {Promise<null>}
   */
  keypress(key) {
    return this.keyhelper('keypress', key);
  }

  /**
   * Equivalent to pressing and holding the remote control key given.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-keydown/key}
   * @param {string} key A key from the keys module.
   * @return {Promise<null>}
   */
  keydown(key) {
    return this.keyhelper('keydown', key);
  }

  /**
   * Equivalent to releasing the remote control key given. Only makes sense
   * if `keydown` was already called for the same key.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-keyup/key}
   * @param {string} key A key from the keys module.
   * @return {Promise<null>}
   */
  keyup(key) {
    return this.keyhelper('keyup', key);
  }

  /**
   * Send the given string to the Roku device.
   * A shorthand for calling `keypress` for each letter in the given string.
   * @see {@link https://sdkdocs.roku.com/display/sdkdoc/External+Control+API#ExternalControlAPI-KeypressKeyValues}
   * @param {string} text The message to send.
   * @return {Promise<null>}
   */
  text(text) {
    return reduce(
      text,
      (promise, letter) => promise.then(() => this.keypress(letter)),
      Promise.resolve(),
    );
  }

  /**
   * Chain multiple remote commands together in one convenient api.
   * Each value in the `keys` module is available as a command in
   * camelcase form, and can take an optional number to indicate how many
   * times the button should be pressed. A `text` method is also available
   * to send a full string. After composing the command, `send` should
   * be called to perform the scripted commands. The result of calling
   * `.command()` can be stored in a variable and modified, but should not
   * be reused after calling `.send()`.
   *
   * @example
   * client.command()
   *     .volumeUp(10)
   *     .up(2)
   *     .select()
   *     .text('Breaking Bad')
   *     .enter()
   *     .send();
   *
   * @return {Commander} A commander instance.
   */
  command() {
    return new Commander(this);
  }
}
