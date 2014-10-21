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

/* global punycode, µMatrix */
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

var stateToNameMap = {
    '1': 'block',
    '2': 'allow',
    '3': 'inherit'
};

var nameToStateMap = {
      'block': 1,
      'allow': 2,
    'inherit': 3
};

var nameToSwitchMap = {
      'on': true,
      'off': false
};

/******************************************************************************/

var columnHeaders = (function() {
    var out = {};
    var i = 0;
    for ( var type in typeBitOffsets ) {
        if ( typeBitOffsets.hasOwnProperty(type) === false ) {
            continue;
        }
        out[type] = i++;
    }
    return out;
})();

/******************************************************************************/

Matrix.getColumnHeaders = function() {
    return columnHeaders;
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

Matrix.prototype.setCell = function(srcHostname, desHostname, type, state) {
    var bitOffset = typeBitOffsets[type];
    var k = srcHostname + ' ' + desHostname;
    var oldBitmap = this.rules[k];
    if ( oldBitmap === undefined ) {
        oldBitmap = 0;
    }
    var newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
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
    if ( this.evaluateSwitchZ(srcHostname) !== true ) {
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
        // TODO: external rules? (for presets)
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

Matrix.prototype.toggleSwitch = function(srcHostname, newState) {
    if ( newState === undefined ) {
        newState = !this.evaluateSwitchZ(srcHostname);
    }
    delete this.switchedOn[srcHostname];
    var oldState = this.evaluateSwitchZ(srcHostname);
    if ( newState === oldState ) {
        return false;
    }
    this.switchedOn[srcHostname] = newState;
    return true;
};

/******************************************************************************/

Matrix.prototype.evaluateSwitch = function(srcHostname) {
    var b = this.switchedOn[srcHostname];
    if ( b !== undefined ) {
        return b;
    }
    return true;
};

/******************************************************************************/

Matrix.prototype.evaluateSwitchZ = function(srcHostname) {
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

Matrix.prototype.toString = function() {
    var out = [];
    var rule, type, val;
    var srcHostname, desHostname;
    for ( rule in this.rules ) {
        if ( this.rules.hasOwnProperty(rule) === false ) {
            continue;
        }
        srcHostname = this.srcHostnameFromRule(rule);
        desHostname = this.desHostnameFromRule(rule);
        for ( type in typeBitOffsets ) {
            if ( typeBitOffsets.hasOwnProperty(type) === false ) {
                continue;
            }
            val = this.evaluateCell(srcHostname, desHostname, type);
            if ( val === 0 ) {
                continue;
            }
            out.push(srcHostname + ' ' + desHostname + ' ' + type + ' ' + stateToNameMap[val]);
        }
    }
    for ( srcHostname in this.switchedOn ) {
        if ( this.switchedOn.hasOwnProperty(srcHostname) === false ) {
            continue;
        }
        val = this.switchedOn[srcHostname] ? 'on' : 'off';
        out.push(srcHostname + ' switch: ' + val);
    }
    return out.sort().join('\n');
};

/******************************************************************************/

Matrix.prototype.fromString = function(text) {
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, pos;
    var fields, nextField, fieldVal;
    var srcHostname = '';
    var desHostname = '';
    var type, state;

    while ( lineBeg < textEnd ) {
        lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = textEnd;
            }
        }
        line = text.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;

        pos = line.indexOf('# ');
        if ( pos !== -1 ) {
            line = line.slice(0, pos).trim();
        }
        if ( line === '' ) {
            continue;
        }

        fields = line.split(/\s+/);

        // Special directives:

        // title
        pos = fields[0].indexOf('title:');
        if ( pos !== -1 ) {
            // TODO
            continue;
        }

        // Name
        pos = fields[0].indexOf('name:');
        if ( pos !== -1 ) {
            // TODO
            continue;
        }

        // Valid rule syntax:

        // srcHostname desHostname type state
        //      type = a valid request type
        //      state = [`block`, `allow`, `inherit`]

        // srcHostname desHostname type
        //      type = a valid request type
        //      state = `allow`

        // srcHostname desHostname
        //      type = `*`
        //      state = `allow`

        // desHostname
        //      srcHostname from a previous line
        //      type = `*`
        //      state = `allow`

        // srcHostname `switch:` state
        //      state = [`on`, `off`]

        // `switch:` state
        //      srcHostname from a previous line
        //      state = [`on`, `off`]

       // Lines with invalid syntax silently ignored

        if ( fields.length === 1 ) {
            // Can't infer srcHostname: reject
            if ( srcHostname === '' ) {
                continue;
            }
            desHostname = punycode.toASCII(fields[0]);
            nextField = 1;
        } else {
            srcHostname = punycode.toASCII(fields[0]);
            desHostname = punycode.toASCII(fields[1]);
            nextField = 2;
        }

        fieldVal = fields[nextField];
        nextField += 1;

        // Special rule: switch on/off

        if ( desHostname === 'switch:' ) {
            // No state field: reject
            if ( fieldVal === null ) {
                continue;
            }
            // Unknown state: reject
            if ( nameToSwitchMap.hasOwnProperty(fieldVal) === false ) {
                continue;
            }
            this.setSwitch(srcHostname, nameToSwitchMap[fieldVal]);
            continue;
        }

        // Standard rule

        if ( fieldVal !== null ) {
            type = fieldVal;
            // Unknown type: reject
            if ( typeBitOffsets.hasOwnProperty(type) === false ) {
                continue;
            }
        } else {
            type = '*';
        }

        fieldVal = fields[nextField];
        nextField += 1;

        if ( fieldVal !== null ) {
            // Unknown state: reject
            if ( nameToStateMap.hasOwnProperty(fieldVal) === false ) {
                continue;
            }
            state = nameToStateMap[fieldVal];
        } else {
            state = 2;
        }

        this.setCell(srcHostname, desHostname, type, state);
    }
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

Matrix.prototype.diff = function(other, srcHostname, desHostnames) {
    var out = [];
    var desHostname, type;
    var i, pos, thisVal, otherVal;
    for (;;) {
        thisVal = this.evaluateSwitch(srcHostname);
        otherVal = other.evaluateSwitch(srcHostname);
        if ( thisVal !== otherVal ) {
            out.push({
                'what': 'switch',
                'src': srcHostname
            });
        }
        i = desHostnames.length;
        while ( i-- ) {
            desHostname = desHostnames[i];
            for ( type in typeBitOffsets ) {
                if ( typeBitOffsets.hasOwnProperty(type) === false ) {
                    continue;
                }
                thisVal = this.evaluateCell(srcHostname, desHostname, type);
                otherVal = other.evaluateCell(srcHostname, desHostname, type);
                if ( thisVal === otherVal ) {
                    continue;
                }
                out.push({
                    'what': 'rule',
                    'src': srcHostname,
                    'des': desHostname,
                    'type': type
                });
            }
        }
        if ( srcHostname === '*' ) {
            break;
        }
        pos = srcHostname.indexOf('.');
        if ( pos !== -1 ) {
            srcHostname = srcHostname.slice(pos + 1);
        } else {
            srcHostname = '*';
        }
    }
    return out;
};

/******************************************************************************/

Matrix.prototype.applyDiff = function(diff, from) {
    var changed = false;
    var i = diff.length;
    var action, val;
    while ( i-- ) {
        action = diff[i];
        if ( action.what === 'switch' ) {
            val = from.evaluateSwitch(action.src);
            changed = this.setSwitch(action.src, val) || changed;
            continue;
        }
        if ( action.what === 'rule' ) {
            val = from.evaluateCell(action.src, action.des, action.type);
            changed = this.setCell(action.src, action.des, action.type, val) || changed;
            continue;
        }
    }
    return changed;
};

/******************************************************************************/

return Matrix;

/******************************************************************************/

// https://www.youtube.com/watch?v=wlNrQGmj6oQ

})();

/******************************************************************************/
