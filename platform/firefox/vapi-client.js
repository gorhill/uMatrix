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

/* jshint esnext: true */
/* global addMessageListener, removeMessageListener, sendAsyncMessage */

// For non background pages

'use strict';

/******************************************************************************/

(function(self) {

/******************************************************************************/

// https://bugs.chromium.org/p/project-zero/issues/detail?id=1225&desc=6#c10
if ( self.vAPI === undefined || self.vAPI.uMatrix !== true ) {
    self.vAPI = { uMatrix: true };
}

var vAPI = self.vAPI;
vAPI.firefox = true;
vAPI.sessionId = String.fromCharCode(Date.now() % 25 + 97) +
    Math.random().toString(36).slice(2);

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || function(callback, delay) {
    return setTimeout(function() { callback(); }, delay);
};

/******************************************************************************/

vAPI.shutdown = (function() {
    var jobs = [];

    var add = function(job) {
        jobs.push(job);
    };

    var exec = function() {
        //console.debug('Shutting down...');
        var job;
        while ( (job = jobs.pop()) ) {
            job();
        }
    };

    return {
        add: add,
        exec: exec
    };
})();

/******************************************************************************/

vAPI.messaging = {
    listeners: new Set(),
    pending: new Map(),
    requestId: 1,
    connected: false,

    setup: function() {
        this.addListener(this.builtinListener);
        if ( this.toggleListenerCallback === null ) {
            this.toggleListenerCallback = this.toggleListener.bind(this);
        }
        window.addEventListener('pagehide', this.toggleListenerCallback, true);
        window.addEventListener('pageshow', this.toggleListenerCallback, true);
    },

    close: function() {
        this.disconnect();
        this.listeners.clear();
        this.pending.clear();
    },

    connect: function() {
        if ( !this.connected ) {
            if ( this.messageListenerCallback === null ) {
                this.messageListenerCallback = this.messageListener.bind(this);
            }
            addMessageListener(this.messageListenerCallback);
            this.connected = true;
        }
    },

    disconnect: function() {
        if ( this.connected ) {
            removeMessageListener();
            this.connected = false;
        }
    },

    messageListener: function(msg) {
        var details = JSON.parse(msg);
        if ( !details ) {
            return;
        }

        if ( details.broadcast ) {
            this.sendToListeners(details.msg);
            return;
        }

        if ( details.requestId ) {
            var listener = this.pending.get(details.requestId);
            if ( listener !== undefined ) {
                this.pending.delete(details.requestId);
                listener(details.msg);
                return;
            }
        }
    },
    messageListenerCallback: null,

    builtinListener: function(msg) {
        if ( typeof msg.cmd === 'string' && msg.cmd === 'injectScript' ) {
            var details = msg.details;
            if ( !details.allFrames && window !== window.top ) {
                return;
            }
            self.injectScript(details.file);
        }
    },

    send: function(channelName, message, callback) {
        this.connect()

        message = {
            channelName: self._sandboxId_ + '|' + channelName,
            msg: message
        };

        if ( callback ) {
            message.requestId = this.requestId++;
            this.pending.set(message.requestId, callback);
        }

        sendAsyncMessage('umatrix:background', message);
    },

    toggleListener: function({type, persisted}) {
        if ( !vAPI.messaging.connected ) {
            return;
        }

        if ( type === 'pagehide' ) {
            this.disconnect();
            return;
        }

        if ( persisted ) {
            this.connect();
        }
    },
    toggleListenerCallback: null,

    sendToListeners: function(msg) {
        for ( var listener of this.listeners ) {
            listener(msg);
        }
    },

    addListener: function(listener) {
        this.listeners.add(listener);
        this.connect()
    }
};

vAPI.messaging.setup()

/******************************************************************************/

// No need to have vAPI client linger around after shutdown if
// we are not a top window (because element picker can still
// be injected in top window).
if ( window !== window.top ) {
    // Can anything be done?
}

/******************************************************************************/

})(this);

/******************************************************************************/
