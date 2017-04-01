/*******************************************************************************

    uMatrix - a browser extension to block requests.
    Copyright (C) 2014-2017 The uMatrix/uBlock Origin authors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

/* global ADDON_UNINSTALL, APP_SHUTDOWN */
/* exported startup, shutdown, install, uninstall */

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci} = Components;

// Accessing the context of the background page:
// var win = Services.appShell.hiddenDOMWindow.document.querySelector('iframe[src*=umatrix]').contentWindow;

let windowlessBrowser = null;
let windowlessBrowserPL = null;
let bgProcess = null;
let version;
const hostName = 'umatrix';
const restartListener = {
    get messageManager() {
        return Components.classes['@mozilla.org/parentprocessmessagemanager;1']
            .getService(Components.interfaces.nsIMessageListenerManager);
    },

    receiveMessage: function() {
        shutdown();
        startup();
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2493
// Fix by https://github.com/gijsk
//     imported from https://github.com/gorhill/uBlock/pull/2497

function startup(data/*, reason*/) {
    if ( data !== undefined ) {
        version = data.version;
    }

    // Already started?
    if ( bgProcess !== null ) {
        return;
    }

    waitForHiddenWindow();
}

function createBgProcess(parentDocument) {
    bgProcess = parentDocument.documentElement.appendChild(
        parentDocument.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
    );
    bgProcess.setAttribute(
        'src',
        'chrome://' + hostName + '/content/background.html#' + version
    );

    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIMessageListenerManager#addMessageListener%28%29
    // "If the same listener registers twice for the same message, the
    // "second registration is ignored."
    restartListener.messageManager.addMessageListener(
        hostName + '-restart',
        restartListener
    );
}

function getWindowlessBrowserFrame(appShell) {
    windowlessBrowser = appShell.createWindowlessBrowser(true);
    windowlessBrowser.QueryInterface(Ci.nsIInterfaceRequestor);
    let webProgress = windowlessBrowser.getInterface(Ci.nsIWebProgress);
    let XPCOMUtils = Components.utils.import('resource://gre/modules/XPCOMUtils.jsm', null).XPCOMUtils;
    windowlessBrowserPL = {
        QueryInterface: XPCOMUtils.generateQI([
            Ci.nsIWebProgressListener,
            Ci.nsIWebProgressListener2,
            Ci.nsISupportsWeakReference
        ]),
        onStateChange: function(wbp, request, stateFlags, status) {
            if ( !request ) { return; }
            if ( stateFlags & Ci.nsIWebProgressListener.STATE_STOP ) {
                webProgress.removeProgressListener(windowlessBrowserPL);
                windowlessBrowserPL = null;
                createBgProcess(windowlessBrowser.document);
            }
        }
    };
    webProgress.addProgressListener(windowlessBrowserPL, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
    windowlessBrowser.document.location = "data:application/vnd.mozilla.xul+xml;charset=utf-8,<window%20id='" + hostName + "-win'/>";
}

function waitForHiddenWindow() {
    let appShell = Cc['@mozilla.org/appshell/appShellService;1']
        .getService(Ci.nsIAppShellService);

    let onReady = function(e) {
        if ( e ) {
            this.removeEventListener(e.type, onReady);
        }

        let hiddenDoc = appShell.hiddenDOMWindow.document;

        // https://github.com/gorhill/uBlock/issues/10
        // Fixed by github.com/AlexVallat:
        //   https://github.com/chrisaljoudi/uBlock/issues/1149
        //   https://github.com/AlexVallat/uBlock/commit/e762a29d308caa46578cdc34a9be92c4ad5ecdd0
        if ( !hiddenDoc || hiddenDoc.readyState === 'loading' ) {
            appShell.hiddenDOMWindow.addEventListener('DOMContentLoaded', onReady);
            return;
        }

        // Fix from https://github.com/gijsk, taken from:
        // - https://github.com/gorhill/uBlock/commit/53a794d9b2a8c65406ee7a201cacbc91c297b2f8
        // 
        // In theory, it should be possible to create a windowless browser
        // immediately, without waiting for the hidden window to have loaded
        // completely. However, in practice, on Windows this seems to lead
        // to a broken Firefox appearance. To avoid this, we only create the
        // windowless browser here. We'll use that rather than the hidden
        // window for the actual background page (windowless browsers are
        // also what the webextension implementation in Firefox uses for
        // background pages).
        if ( appShell.createWindowlessBrowser ) {
            getWindowlessBrowserFrame(appShell);
        } else {
            createBgProcess(hiddenDoc);
        }
    };

    var ready = false;
    try {
        ready = appShell.hiddenDOMWindow &&
                appShell.hiddenDOMWindow.document;
    } catch (ex) {
    }
    if ( ready ) {
        onReady();
        return;
    }

    let ww = Components.classes['@mozilla.org/embedcomp/window-watcher;1']
                       .getService(Components.interfaces.nsIWindowWatcher);

    ww.registerNotification({
        observe: function(win, topic) {
            if ( topic !== 'domwindowopened' ) {
                return;
            }
            try {
                void appShell.hiddenDOMWindow;
            } catch (ex) {
                return;
            }
            ww.unregisterNotification(this);
            onReady();
        }
    });
}

/******************************************************************************/

function shutdown(data, reason) {
    if ( reason === APP_SHUTDOWN ) {
        return;
    }

    if ( bgProcess !== null ) {
        bgProcess.parentNode.removeChild(bgProcess);
        bgProcess = null;
    }

    if ( windowlessBrowser !== null ) {
        // close() does not exist for older versions of Firefox.
        if ( typeof windowlessBrowser.close === 'function' ) {
            windowlessBrowser.close();
        }
        windowlessBrowser = null;
        windowlessBrowserPL = null;
    }

    if ( data === undefined ) {
        return;
    }

    // Remove the restartObserver only when the extension is being disabled
    restartListener.messageManager.removeMessageListener(
        hostName + '-restart',
        restartListener
    );
}

/******************************************************************************/

function install() {
    // https://bugzil.la/719376
    Components.classes['@mozilla.org/intl/stringbundle;1']
        .getService(Components.interfaces.nsIStringBundleService)
        .flushBundles();
}

/******************************************************************************/

function uninstall(data, aReason) {
    if ( aReason !== ADDON_UNINSTALL ) {
        return;
    }
    // To cleanup vAPI.localStorage in vapi-common.js, aka
    // "extensions.umatrix.*" in `about:config`.
    Components.utils.import('resource://gre/modules/Services.jsm', null)
        .Services.prefs
            .getBranch('extensions.' + hostName + '.')
            .deleteBranch('');
}

/******************************************************************************/
