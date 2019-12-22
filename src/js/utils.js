/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2018 Raymond Hill

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

'use strict';

/******************************************************************************/

µMatrix.gotoExtensionURL = function(details) {
    if ( details.url.startsWith('logger-ui.html') ) {
        if ( details.shiftKey ) {
            this.changeUserSettings(
                'alwaysDetachLogger',
                this.userSettings.alwaysDetachLogger === false
            );
        }
        if ( this.userSettings.alwaysDetachLogger ) {
            details.popup = this.rawSettings.loggerPopupType;
            const url = new URL(vAPI.getURL(details.url));
            url.searchParams.set('popup', '1');
            details.url = url.href;
            let popupLoggerBox;
            try {
                popupLoggerBox = JSON.parse(
                    vAPI.localStorage.getItem('popupLoggerBox')
                );
            } catch(ex) {
            }
            if ( popupLoggerBox !== undefined ) {
                details.box = popupLoggerBox;
            }
        }
    }
    vAPI.tabs.open(details);
};

/******************************************************************************/

µMatrix.LineIterator = function(text, offset) {
    this.text = text;
    this.textLen = this.text.length;
    this.offset = offset || 0;
};

µMatrix.LineIterator.prototype = {
    next: function() {
        var lineEnd = this.text.indexOf('\n', this.offset);
        if ( lineEnd === -1 ) {
            lineEnd = this.text.indexOf('\r', this.offset);
            if ( lineEnd === -1 ) {
                lineEnd = this.textLen;
            }
        }
        var line = this.text.slice(this.offset, lineEnd);
        this.offset = lineEnd + 1;
        return line;
    },
    rewind: function() {
        if ( this.offset <= 1 ) {
            this.offset = 0;
            return;
        }
        var lineEnd = this.text.lastIndexOf('\n', this.offset - 2);
        if ( lineEnd !== -1 ) {
            this.offset = lineEnd + 1;
        } else {
            lineEnd = this.text.lastIndexOf('\r', this.offset - 2);
            this.offset = lineEnd !== -1 ? lineEnd + 1 : 0;
        }
    },
    eot: function() {
        return this.offset >= this.textLen;
    }
};

/******************************************************************************/

µMatrix.toMap = function(input) {
    if ( input instanceof Map ) {
        return input;
    }
    if ( Array.isArray(input) ) {
        return new Map(input);
    }
    let out = new Map();
    if ( input instanceof Object ) {
        for ( let key in input ) {
            if ( input.hasOwnProperty(key) ) {
                out.set(key, input[key]);
            }
        }
    }
    return out;
};

/******************************************************************************/

µMatrix.arraysIntersect = function(a1, a2) {
    for ( let v of a1 ) {
        if ( a2.indexOf(v) !== -1 ) { return true; }
    }
    return false;
};

/******************************************************************************/

// Custom base64 encoder/decoder
//
// TODO:
//   Could expand the LZ4 codec API to be able to return UTF8-safe string
//   representation of a compressed buffer, and thus the code below could be
//   moved LZ4 codec-side.
// https://github.com/uBlockOrigin/uBlock-issues/issues/461
//   Provide a fallback encoding for Chromium 59 and less by issuing a plain
//   JSON string. The fallback can be removed once min supported version is
//   above 59.

µMatrix.base64 = new (class {
    constructor() {
        this.valToDigit = new Uint8Array(64);
        this.digitToVal = new Uint8Array(128);
        const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@%";
        for ( let i = 0, n = chars.length; i < n; i++ ) {
            const c = chars.charCodeAt(i);
            this.valToDigit[i] = c;
            this.digitToVal[c] = i;
        }
        this.magic = 'Base64_1';
    }

    encode(arrbuf, arrlen) {
        const inputLength = (arrlen + 3) >>> 2;
        const inbuf = new Uint32Array(arrbuf, 0, inputLength);
        const outputLength = this.magic.length + 7 + inputLength * 7;
        const outbuf = new Uint8Array(outputLength);
        let j = 0;
        for ( let i = 0; i < this.magic.length; i++ ) {
            outbuf[j++] = this.magic.charCodeAt(i);
        }
        let v = inputLength;
        do {
            outbuf[j++] = this.valToDigit[v & 0b111111];
            v >>>= 6;
        } while ( v !== 0 );
        outbuf[j++] = 0x20 /* ' ' */;
        for ( let i = 0; i < inputLength; i++ ) {
            v = inbuf[i];
            do {
                outbuf[j++] = this.valToDigit[v & 0b111111];
                v >>>= 6;
            } while ( v !== 0 );
            outbuf[j++] = 0x20 /* ' ' */;
        }
        if ( typeof TextDecoder === 'undefined' ) {
            return JSON.stringify(
                Array.from(new Uint32Array(outbuf.buffer, 0, j >>> 2))
            );
        }
        const textDecoder = new TextDecoder();
        return textDecoder.decode(new Uint8Array(outbuf.buffer, 0, j));
    }

    decode(instr, arrbuf) {
        if (  instr.charCodeAt(0) === 0x5B /* '[' */ ) {
            const inbuf = JSON.parse(instr);
            if ( arrbuf instanceof ArrayBuffer === false ) {
                return new Uint32Array(inbuf);
            }
            const outbuf = new Uint32Array(arrbuf);
            outbuf.set(inbuf);
            return outbuf;
        }
        if ( instr.startsWith(this.magic) === false ) {
            throw new Error('Invalid µBlock.base64 encoding');
        }
        const inputLength = instr.length;
        const outbuf = arrbuf instanceof ArrayBuffer === false
            ? new Uint32Array(this.decodeSize(instr) >> 2)
            : new Uint32Array(arrbuf);
        let i = instr.indexOf(' ', this.magic.length) + 1;
        if ( i === -1 ) {
            throw new Error('Invalid µBlock.base64 encoding');
        }
        let j = 0;
        for (;;) {
            if ( i === inputLength ) { break; }
            let v = 0, l = 0;
            for (;;) {
                const c = instr.charCodeAt(i++);
                if ( c === 0x20 /* ' ' */ ) { break; }
                v += this.digitToVal[c] << l;
                l += 6;
            }
            outbuf[j++] = v;
        }
        return outbuf;
    }

    decodeSize(instr) {
        if ( instr.startsWith(this.magic) === false ) { return 0; }
        let v = 0, l = 0, i = this.magic.length;
        for (;;) {
            const c = instr.charCodeAt(i++);
            if ( c === 0x20 /* ' ' */ ) { break; }
            v += this.digitToVal[c] << l;
            l += 6;
        }
        return v << 2;
    }
})();

/******************************************************************************/

µMatrix.fireDOMEvent = function(name) {
    if (
        window instanceof Object &&
        window.dispatchEvent instanceof Function &&
        window.CustomEvent instanceof Function
    ) {
        window.dispatchEvent(new CustomEvent(name));
    }
};

/******************************************************************************/
