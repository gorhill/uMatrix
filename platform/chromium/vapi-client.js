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
var chrome = self.chrome;

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.vapiClientInjected ) {
    //console.debug('vapi-client.js already injected: skipping.');
    return;
}
vAPI.vapiClientInjected = true;

vAPI.sessionId = String.fromCharCode(Date.now() % 26 + 97) +
                 Math.random().toString(36).slice(2);
vAPI.chrome = true;

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
    port: null,
    portTimer: null,
    portTimerDelay: 10000,
    listeners: new Set(),
    pending: new Map(),
    auxProcessId: 1,
    shuttingDown: false,

    shutdown: function() {
        this.shuttingDown = true;
        this.destroyPort();
    },

    disconnectListener: function() {
        this.port = null;
        vAPI.shutdown.exec();
    },
    disconnectListenerBound: null,

    messageListener: function(details) {
        if ( !details ) { return; }

        // Sent to all listeners
        if ( details.broadcast ) {
            this.sendToListeners(details.msg);
            return;
        }

        // Response to specific message previously sent
        var listener;
        if ( details.auxProcessId ) {
            listener = this.pending.get(details.auxProcessId);
            if ( listener !== undefined ) {
                this.pending.delete(details.auxProcessId);
                listener(details.msg);
                return;
            }
        }
    },
    messageListenerCallback: null,

    portPoller: function() {
        this.portTimer = null;
        if (
            this.port !== null &&
            this.listeners.size === 0 &&
            this.pending.size === 0
        ) {
            return this.destroyPort();
        }
        this.portTimer = vAPI.setTimeout(this.portPollerBound, this.portTimerDelay);
        this.portTimerDelay = Math.min(this.portTimerDelay * 2, 60 * 60 * 1000);
    },
    portPollerBound: null,

    destroyPort: function() {
        if ( this.portTimer !== null ) {
            clearTimeout(this.portTimer);
            this.portTimer = null;
        }
        var port = this.port;
        if ( port !== null ) {
            port.disconnect();
            port.onMessage.removeListener(this.messageListenerCallback);
            port.onDisconnect.removeListener(this.disconnectListenerBound);
            this.port = null;
        }
        this.listeners.clear();
        // service pending callbacks
        if ( this.pending.size !== 0 ) {
            var pending = this.pending;
            this.pending = new Map();
            for ( var callback of pending.values() ) {
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        }
    },

    createPort: function() {
        if ( this.shuttingDown ) { return null; }
        if ( this.messageListenerCallback === null ) {
            this.messageListenerCallback = this.messageListener.bind(this);
            this.disconnectListenerBound = this.disconnectListener.bind(this);
            this.portPollerBound = this.portPoller.bind(this);
        }
        try {
            this.port = chrome.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
            this.port = null;
        }
        if ( this.port !== null ) {
            this.port.onMessage.addListener(this.messageListenerCallback);
            this.port.onDisconnect.addListener(this.disconnectListenerBound);
            this.portTimerDelay = 10000;
            if ( this.portTimer === null ) {
                this.portTimer = vAPI.setTimeout(
                    this.portPollerBound,
                    this.portTimerDelay
                );
            }
        }
        return this.port;
    },

    getPort: function() {
        return this.port !== null ? this.port : this.createPort();
    },

    send: function(channelName, message, callback) {
        // Too large a gap between the last request and the last response means
        // the main process is no longer reachable: memory leaks and bad
        // performance become a risk -- especially for long-lived, dynamic
        // pages. Guard against this.
        if ( this.pending.size > 25 ) {
            vAPI.shutdown.exec();
        }
        var port = this.getPort();
        if ( port === null ) {
            if ( typeof callback === 'function' ) { callback(); }
            return;
        }
        var auxProcessId;
        if ( callback ) {
            auxProcessId = this.auxProcessId++;
            this.pending.set(auxProcessId, callback);
        }
        port.postMessage({
            channelName: channelName,
            auxProcessId: auxProcessId,
            msg: message
        });
    },

    addListener: function(listener) {
        this.listeners.add(listener);
        this.getPort();
    },

    removeListener: function(listener) {
        this.listeners.delete(listener);
    },

    removeAllListeners: function() {
        this.listeners.clear();
    },

    sendToListeners: function(msg) {
        for ( var listener of this.listeners ) {
            listener(msg);
        }
    }
};

/******************************************************************************/

// No need to have vAPI client linger around after shutdown if
// we are not a top window (because element picker can still
// be injected in top window).
if ( window !== window.top ) {
    vAPI.shutdown.add(function() {
        vAPI = null;
    });
}

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || function(callback, delay) {
    setTimeout(function() { callback(); }, delay);
};

/******************************************************************************/

})(this); // jshint ignore: line

/******************************************************************************/
