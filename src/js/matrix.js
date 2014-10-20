/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

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

/* global µMatrix */
/* jshint bitwise: false */

/******************************************************************************/

µMatrix.Matrix = (function() {

/******************************************************************************/

var µm = µMatrix;
var magicId = 'tckuvvpyvswo';

/******************************************************************************/

var Matrix = function() {
    this.reset();
};

/******************************************************************************/

Matrix.Transparent   = 0;
Matrix.Red           = 1;
Matrix.Green         = 2;
Matrix.Gray          = 3;

Matrix.Indirect      = 0x00;
Matrix.Direct        = 0x80;

Matrix.RedDirect     = Matrix.Red | Matrix.Direct;
Matrix.RedIndirect   = Matrix.Red | Matrix.Indirect;
Matrix.GreenDirect   = Matrix.Green | Matrix.Direct;
Matrix.GreenIndirect = Matrix.Green | Matrix.Indirect;
Matrix.GrayDirect    = Matrix.Gray | Matrix.Direct;
Matrix.GrayIndirect  = Matrix.Gray | Matrix.Indirect;

/******************************************************************************/

var typeBitOffsets = {
         '*':  0,
    'cookie':  2,
       'css':  4,
     'image':  6,
    'plugin':  8,
    'script': 10,
       'xhr': 12,
     'frame': 14,
     'other': 16
};

/******************************************************************************/

Matrix.prototype.reset = function() {
    this.switchedOn = {};
    this.rules = {};
    this.rootValue = Matrix.GreenIndirect;
};

/******************************************************************************/

// Copy another matrix to self

Matrix.prototype.assign = function(other) {
    this.reset();
    var k;
    for ( k in other.rules ) {
        if ( other.rules.hasOwnProperty(k) === false ) {
            continue;
        }
        this.rules[k] = other.rules[k];
    }
    for ( k in other.switchedOn ) {
        if ( other.switchedOn.hasOwnProperty(k) === false ) {
            continue;
        }
        this.switchedOn[k] = other.switchedOn[k];
    }
};

/******************************************************************************/

// If value is undefined, the rule is removed

Matrix.prototype.setRule = function(rule, value) {
    if ( value !== undefined ) {
        if ( this.rules.hasOwnProperty(rule) === false || this.rules[rule] !== value ) {
            this.rules[rule] = value;
            return true;
        }
    } else {
        if ( this.rules.hasOwnProperty(rule) ) {
            delete this.rules[rule];
            return true;
        }
    }
    return false;
};

/******************************************************************************/

// If value is undefined, the switch is removed

Matrix.prototype.setSwitch = function(srcHostname, state) {
    if ( state !== undefined ) {
        if ( this.switchedOn.hasOwnProperty(srcHostname) === false || this.switchedOn[srcHostname] !== state ) {
            this.switchedOn[srcHostname] = state;
            return true;
        }
    } else {
        if ( this.switchedOn.hasOwnProperty(srcHostname) ) {
            delete this.switchedOn[srcHostname];
            return true;
        }
    }
    return false;
};

/******************************************************************************/

Matrix.prototype.setCell = function(srcHostname, desHostname, type, v) {
    var bitOffset = typeBitOffsets[type];
    var k = srcHostname + ' ' + desHostname;
    var oldBitmap = this.rules[k];
    if ( oldBitmap === undefined ) {
        oldBitmap = 0;
    }
    var newBitmap = oldBitmap & ~(3 << bitOffset) | (v << bitOffset);
    if ( newBitmap === oldBitmap ) {
        return false;
    }
    if ( newBitmap === 0 ) {
        delete this.rules[k];
    } else {
        this.rules[k] = newBitmap;
    }
    return true;
};

/******************************************************************************/

Matrix.prototype.blacklistCell = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, 1);
    return true;
};

/******************************************************************************/

Matrix.prototype.whitelistCell = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 2 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 2 ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, 2);
    return true;
};

/******************************************************************************/

Matrix.prototype.graylistCell = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 0 || r === 3 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 0 || r === 3 ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, 3);
    return true;
};

/******************************************************************************/

Matrix.prototype.evaluateCell = function(srcHostname, desHostname, type) {
    var key = srcHostname + ' ' + desHostname;
    var bitmap = this.rules[key];
    if ( bitmap === undefined ) {
        return 0;
    }
    return bitmap >> typeBitOffsets[type] & 3;
};

/******************************************************************************/

Matrix.prototype.evaluateCellZ = function(srcHostname, desHostname, type) {
    if ( this.evaluateSwitch(srcHostname) !== true ) {
        return Matrix.Transparent;
    }
    var bitOffset = typeBitOffsets[type];
    var s = srcHostname;
    var v, pos;
    for (;;) {
        v = this.rules[s + ' ' + desHostname];
        if ( v !== undefined ) {
            v = v >> bitOffset & 3;
            if ( v !== 0 ) {
                return v;
            }
        }
        pos = s.indexOf('.');
        if ( pos !== -1 ) {
            s = s.slice(pos + 1);
            continue;
        }
        if ( s !== '*' ) {
            s = '*';
            continue;
        }
        break;
    }
    // Preset blacklisted hostnames are blacklisted in global scope
    if ( type === '*' && µm.ubiquitousBlacklist.test(desHostname) ) {
        return 1;
    }
    return 0;
};

/******************************************************************************/

Matrix.prototype.evaluateCellZXY = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) { return Matrix.RedDirect; }
    if ( r === 2 ) { return Matrix.GreenDirect; }
    var rl = this.evaluateCellZ(srcHostname, desHostname, '*');
    if ( rl === 1 ) { return Matrix.RedIndirect; }
    var d = desHostname;
    var pos;
    for (;;) {
        pos = d.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        d = d.slice(pos + 1);
        r = this.evaluateCellZ(srcHostname, d, type);
        if ( r === 1 ) { return Matrix.RedIndirect; }
        if ( r === 2 ) { return Matrix.GreenIndirect; }
        if ( rl !==  2 ) {
            rl = this.evaluateCellZ(srcHostname, d, '*');
            if ( rl === 1 ) { return Matrix.RedIndirect; }
        }
    }
    r = this.evaluateCellZ(srcHostname, '*', type);
    if ( r === 1 ) { return Matrix.RedIndirect; }
    if ( rl === 2 ) { return Matrix.GreenIndirect; }
    if ( r === 2 ) { return Matrix.GreenIndirect; }
    r = this.evaluateCellZ(srcHostname, '*', '*');
    if ( r === 1 ) { return Matrix.RedIndirect; }
    if ( r === 2 ) { return Matrix.GreenIndirect; }
    return this.rootValue;
};

/******************************************************************************/

Matrix.prototype.evaluateRowZ = function(srcHostname, desHostname) {
    var out = [];
    for ( var type in typeBitOffsets ) {
        if ( typeBitOffsets.hasOwnProperty(type) === false ) {
            continue;
        }
        out.push(this.evaluateCellZ(srcHostname, desHostname, type));
    }
    return out.join('');
};

/******************************************************************************/

Matrix.prototype.evaluateRowZXY = function(srcHostname, desHostname) {
    var out = [];
    for ( var type in typeBitOffsets ) {
        if ( typeBitOffsets.hasOwnProperty(type) === false ) {
            continue;
        }
        out.push(this.evaluateCellZXY(srcHostname, desHostname, type));
    }
    return out;
};

/******************************************************************************/

Matrix.prototype.getColumnHeaders = function() {
    var out = {};
    var i = 0;
    for ( var type in typeBitOffsets ) {
        if ( typeBitOffsets.hasOwnProperty(type) === false ) {
            continue;
        }
        out[type] = i++;
    }
    return out;
};

/******************************************************************************/

Matrix.prototype.mustBlock = function(srcHostname, desHostname, type) {
    return (this.evaluateCellZXY(srcHostname, desHostname, type) & 3) === Matrix.Red;
};

/******************************************************************************/

Matrix.prototype.srcHostnameFromRule = function(rule) {
    return rule.slice(0, rule.indexOf(' '));
};

/******************************************************************************/

Matrix.prototype.desHostnameFromRule = function(rule) {
    return rule.slice(rule.indexOf(' ') + 1);
};

/******************************************************************************/

Matrix.prototype.extractZRules = function(srcHostname, desHostname, out) {
    var s = srcHostname;
    var rule, bitmap, pos;
    for (;;) {
        rule = s + ' ' + desHostname;
        bitmap = this.rules[rule];
        if ( bitmap !== undefined ) {
            out[rule] = bitmap;
        }
        pos = s.indexOf('.');
        if ( pos !== -1 ) {
            s = s.slice(pos + 1);
            continue;
        }
        if ( s !== '*' ) {
            s = '*';
            continue;
        }
        break;
    }
};

/******************************************************************************/

Matrix.prototype.evaluateCellZXYColor = function(srcHostname, desHostname, type) {
    var v = this.evaluateCellZXY(srcHostname, desHostname, type);
    if ( v === Matrix.RedIndirect ) {
        return 'ri';
    }
    if ( v === Matrix.GreenIndirect ) {
        return 'gi';
    }
    if ( v === Matrix.RedDirect ) {
        return 'rd';
    }
    if ( v === Matrix.GreenDirect ) {
        return 'gd';
    }
    return 'xx';
};

/******************************************************************************/

Matrix.prototype.toggleSwitch = function(srcHostname, newState) {
    delete this.switchedOn[srcHostname];
    var oldState = this.evaluateSwitch(srcHostname);
    if ( newState === oldState ) {
        return false;
    }
    this.switchedOn[srcHostname] = newState;
    return true;
};

/******************************************************************************/

Matrix.prototype.evaluateSwitch = function(srcHostname) {
    var b;
    var s = srcHostname;
    var pos;
    for (;;) {
        b = this.switchedOn[s];
        if ( b !== undefined ) {
            return b;
        }
        pos = s.indexOf('.');
        if ( pos !== -1 ) {
            s = s.slice(pos + 1);
            continue;
        }
        if ( s !== '*' ) {
            s = '*';
            continue;
        }
        break;
    }
    return true;
};

/******************************************************************************/

Matrix.prototype.extractSwitches = function(srcHostname, out) {
    var s = srcHostname;
    var v, pos;
    for (;;) {
        v = this.rules[s];
        if ( v !== undefined ) {
            out[s] = v;
        }
        pos = s.indexOf('.');
        if ( pos !== -1 ) {
            s = s.slice(pos + 1);
            continue;
        }
        if ( s !== '*' ) {
            s = '*';
            continue;
        }
        break;
    }
};

/******************************************************************************/

Matrix.prototype.extractAllSourceHostnames = function() {
    var srcHostnames = {};
    var rules = this.rules;
    for ( var rule in rules ) {
        if ( rules.hasOwnProperty(rule) === false ) {
            continue;
        }
        srcHostnames[rule.slice(0, rule.indexOf(' '))] = true;
    }
    return Object.keys(srcHostnames);
};

/******************************************************************************/

Matrix.prototype.toSelfie = function() {
    return {
        magicId: magicId,
        switchedOn: this.switchedOn,
        rules: this.rules
    };
};

/******************************************************************************/

Matrix.prototype.fromSelfie = function(selfie) {
    this.switchedOn = selfie.switchedOn;
    this.rules = selfie.rules;
};

/******************************************************************************/

return Matrix;

/******************************************************************************/

// https://www.youtube.com/watch?v=wlNrQGmj6oQ

})();

/******************************************************************************/
