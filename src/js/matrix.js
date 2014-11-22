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
       'doc':  2,
    'cookie':  4,
       'css':  6,
     'image':  8,
    'plugin': 10,
    'script': 12,
       'xhr': 14,
     'frame': 16,
     'other': 18
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

var switchBitOffsets = {
        'matrix-off': 0,
      'https-strict': 2,
          'ua-spoof': 4,
    'referrer-spoof': 6
};

var switchStateToNameMap = {
    '1': 'true',
    '2': 'false'
};

var nameToSwitchStateMap = {
     'true': 1,
    'false': 2,
       'on': 2,  // backward compatibility
      'off': 1   // backward compatibility
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

var switchNames = (function() {
    var out = {};
    for ( var switchName in switchBitOffsets ) {
        if ( switchBitOffsets.hasOwnProperty(switchName) === false ) {
            continue;
        }
        out[switchName] = true;
    }
    return out;
})();

/******************************************************************************/

Matrix.getSwitchNames = function() {
    return switchNames;
};

/******************************************************************************/

// For performance purpose, as simple tests as possible
var reHostnameVeryCoarse = /[g-z_-]/;
var reIPv4VeryCoarse = /\.\d+$/;

// http://tools.ietf.org/html/rfc5952
// 4.3: "MUST be represented in lowercase"
// Also: http://en.wikipedia.org/wiki/IPv6_address#Literal_IPv6_addresses_in_network_resource_identifiers

var isIPAddress = function(hostname) {
    if ( reHostnameVeryCoarse.test(hostname) ) {
        return false;
    }
    if ( reIPv4VeryCoarse.test(hostname) ) {
        return true;
    }
    return hostname.charAt(0) === '[';
};

/******************************************************************************/

var toBroaderHostname = function(hostname) {
    if ( hostname === '*' ) {
        return '';
    }
    if ( isIPAddress(hostname) ) {
        return '*';
    }
    var pos = hostname.indexOf('.');
    if ( pos === -1 ) {
        return '*';
    }
    return hostname.slice(pos + 1);
};

Matrix.toBroaderHostname = toBroaderHostname;

/******************************************************************************/

// Find out src-des relationship, using coarse-to-fine grained tests for
// speed. If desHostname is 1st-party to srcHostname, the domain is returned,
// otherwise the empty string.

var extractFirstPartyDesDomain = function(srcHostname, desHostname) {
    if ( srcHostname === '*' || desHostname === '*' || desHostname === '1st-party' ) {
        return '';
    }
    var desDomain = µm.URI.domainFromHostname(desHostname);
    if ( desDomain === '' ) {
        return '';
    }
    var pos = srcHostname.length - desDomain.length;
    if ( pos < 0 || srcHostname.slice(pos) !== desDomain ) {
        return '';
    }
    if ( pos !== 0 && srcHostname.charAt(pos - 1) !== '.' ) {
        return '';
    }
    return desDomain;
};

/******************************************************************************/

Matrix.prototype.reset = function() {
    this.switches = {};
    this.rules = {};
    this.rootValue = Matrix.GreenIndirect;
};

/******************************************************************************/

// Copy another matrix to self. Do this incrementally to minimize impact on
// a live matrix.

Matrix.prototype.assign = function(other) {
    var k;
    // Remove rules not in other
    for ( k in this.rules ) {
        if ( this.rules.hasOwnProperty(k) === false ) {
            continue;
        }
        if ( other.rules.hasOwnProperty(k) === false ) {
            delete this.rules[k];
        }
    }
    // Remove switches not in other
    for ( k in this.switches ) {
        if ( this.switches.hasOwnProperty(k) === false ) {
            continue;
        }
        if ( other.switches.hasOwnProperty(k) === false ) {
            delete this.switches[k];
        }
    }
    // Add/change rules in other
    for ( k in other.rules ) {
        if ( other.rules.hasOwnProperty(k) === false ) {
            continue;
        }
        this.rules[k] = other.rules[k];
    }
    // Add/change switches in other
    for ( k in other.switches ) {
        if ( other.switches.hasOwnProperty(k) === false ) {
            continue;
        }
        this.switches[k] = other.switches[k];
    }
    return this;
};

// https://www.youtube.com/watch?v=e9RS4biqyAc

/******************************************************************************/

// If value is undefined, the switch is removed

Matrix.prototype.setSwitch = function(switchName, srcHostname, newVal) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return false;
    }
    if ( newVal === this.evaluateSwitch(switchName, srcHostname) ) {
        return false;
    }
    var bits = this.switches[srcHostname] || 0;
    bits &= ~(3 << bitOffset);
    bits |= newVal << bitOffset;
    if ( bits === 0 ) {
        delete this.switches[srcHostname];
    } else {
        this.switches[srcHostname] = bits;
    }
    return true;
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
    // https://github.com/gorhill/uMatrix/issues/65
    // Hardcoded `doc` rule
    if ( srcHostname === '*' && desHostname === '*' && type === 'doc' ) {
        return 2;
    }

    var bitOffset = typeBitOffsets[type];
    var s = srcHostname;
    var v;
    for (;;) {
        v = this.rules[s + ' ' + desHostname];
        if ( v !== undefined ) {
            v = v >> bitOffset & 3;
            if ( v !== 0 ) {
                return v;
            }
        }
        // TODO: external rules? (for presets)
        s = toBroaderHostname(s);
        if ( s === '' ) {
            break;
        }
    }
    // Preset blacklisted hostnames are blacklisted in global scope
    if ( type === '*' && µm.ubiquitousBlacklist.test(desHostname) ) {
        return 1;
    }
    return 0;
};

/******************************************************************************/

Matrix.prototype.evaluateCellZXY = function(srcHostname, desHostname, type) {
    // Matrix filtering switch
    if ( this.evaluateSwitchZ('matrix-off', srcHostname) ) {
        return Matrix.GreenIndirect;
    }

    // Specific-hostname specific-type cell
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) { return Matrix.RedDirect; }
    if ( r === 2 ) { return Matrix.GreenDirect; }

    // Specific-hostname any-type cell
    var rl = this.evaluateCellZ(srcHostname, desHostname, '*');
    if ( rl === 1 ) { return Matrix.RedIndirect; }

    var d = desHostname;
    var firstPartyDesDomain = extractFirstPartyDesDomain(srcHostname, desHostname);

    // Ancestor cells, up to 1st-party destination domain
    if ( firstPartyDesDomain !== '' ) {
        for (;;) {
            if ( d === firstPartyDesDomain ) {
                break;
            }
            d = d.slice(d.indexOf('.') + 1);

            // specific-hostname specific-type cell
            r = this.evaluateCellZ(srcHostname, d, type);
            if ( r === 1 ) { return Matrix.RedIndirect; }
            if ( r === 2 ) { return Matrix.GreenIndirect; }
            // Do not override a narrower rule
            if ( rl !==  2 ) {
                rl = this.evaluateCellZ(srcHostname, d, '*');
                if ( rl === 1 ) { return Matrix.RedIndirect; }
            }
        }

        // 1st-party specific-type cell: it's a special row, it exists only in
        // global scope.
        r = this.evaluateCellZ(srcHostname, '1st-party', type);
        if ( r === 1 ) { return Matrix.RedIndirect; }
        if ( r === 2 ) { return Matrix.GreenIndirect; }
        // Do not override narrower rule
        if ( rl !==  2 ) {
            rl = this.evaluateCellZ(srcHostname, '1st-party', '*');
            if ( rl === 1 ) { return Matrix.RedIndirect; }
        }
    }

    // Keep going, up to root
    for (;;) {
        d = toBroaderHostname(d);
        if ( d === '*' ) {
            break;
        }

        // specific-hostname specific-type cell
        r = this.evaluateCellZ(srcHostname, d, type);
        if ( r === 1 ) { return Matrix.RedIndirect; }
        if ( r === 2 ) { return Matrix.GreenIndirect; }
        // Do not override narrower rule
        if ( rl !==  2 ) {
            rl = this.evaluateCellZ(srcHostname, d, '*');
            if ( rl === 1 ) { return Matrix.RedIndirect; }
        }
    }

    // Any-hostname specific-type cells
    r = this.evaluateCellZ(srcHostname, '*', type);
    // Line below is strict-blocking
    if ( r === 1 ) { return Matrix.RedIndirect; }
    // Narrower rule wins
    if ( rl === 2 ) { return Matrix.GreenIndirect; }
    if ( r === 2 ) { return Matrix.GreenIndirect; }

    // Any-hostname any-type cell
    r = this.evaluateCellZ(srcHostname, '*', '*');
    if ( r === 1 ) { return Matrix.RedIndirect; }
    if ( r === 2 ) { return Matrix.GreenIndirect; }
    return this.rootValue;
};

// https://www.youtube.com/watch?v=4C5ZkwrnVfM

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

Matrix.prototype.setSwitchZ = function(switchName, srcHostname, newState) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return false;
    }
    var state = this.evaluateSwitchZ(switchName, srcHostname);
    if ( newState === state ) {
        return false;
    }
    if ( newState === undefined ) {
        newState = !state;
    }
    var bits = this.switches[srcHostname] || 0;
    bits &= ~(3 << bitOffset);
    if ( bits === 0 ) {
        delete this.switches[srcHostname];
    } else {
        this.switches[srcHostname] = bits;
    }
    state = this.evaluateSwitchZ(switchName, srcHostname);
    if ( state === newState ) {
        return true;
    }
    this.switches[srcHostname] = bits | ((newState ? 1 : 2) << bitOffset);
    return true;
};

/******************************************************************************/

// 0 = inherit from broader scope, up to default state
// 1 = non-default state
// 2 = forced default state (to override a broader non-default state)

Matrix.prototype.evaluateSwitch = function(switchName, srcHostname) {
    var bits = this.switches[srcHostname] || 0;
    if ( bits === 0 ) {
        return 0;
    }
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return 0;
    }
    return (bits >> bitOffset) & 3;
};

/******************************************************************************/

Matrix.prototype.evaluateSwitchZ = function(switchName, srcHostname) {
    var bitOffset = switchBitOffsets[switchName];
    if ( bitOffset === undefined ) {
        return false;
    }
    var bits;
    var s = srcHostname;
    for (;;) {
        bits = this.switches[s] || 0;
        if ( bits !== 0 ) {
            bits = bits >> bitOffset & 3;
            if ( bits !== 0 ) {
                return bits === 1;
            }
        }
        s = toBroaderHostname(s);
        if ( s === '' ) {
            break;
        }
    }
    return false;
};

/******************************************************************************/

// TODO: In all likelyhood, will have to optmize here, i.e. keeping an
// up-to-date collection of src hostnames with reference count etc.

Matrix.prototype.extractAllSourceHostnames = function() {
    var srcHostnames = {};
    var rules = this.rules;
    for ( var rule in rules ) {
        if ( rules.hasOwnProperty(rule) === false ) {
            continue;
        }
        srcHostnames[rule.slice(0, rule.indexOf(' '))] = true;
    }
    return srcHostnames;
};

/******************************************************************************/

// TODO: In all likelyhood, will have to optmize here, i.e. keeping an
// up-to-date collection of src hostnames with reference count etc.

Matrix.prototype.extractAllDestinationHostnames = function() {
    var desHostnames = {};
    var rules = this.rules;
    for ( var rule in rules ) {
        if ( rules.hasOwnProperty(rule) === false ) {
            continue;
        }
        desHostnames[this.desHostnameFromRule(rule)] = true;
    }
    return desHostnames;
};

/******************************************************************************/

Matrix.prototype.toString = function() {
    var out = [];
    var rule, type, switchName, val;
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
            out.push(
                punycode.toUnicode(srcHostname) + ' ' +
                punycode.toUnicode(desHostname) + ' ' +
                type + ' ' +
                stateToNameMap[val]
            );
        }
    }
    for ( srcHostname in this.switches ) {
        if ( this.switches.hasOwnProperty(srcHostname) === false ) {
            continue;
        }
        for ( switchName in switchBitOffsets ) {
            if ( switchBitOffsets.hasOwnProperty(switchName) === false ) {
                continue;
            }
            val = this.evaluateSwitch(switchName, srcHostname);
            if ( val === 0 ) {
                continue;
            }
            out.push(switchName + ': ' + srcHostname + ' ' + switchStateToNameMap[val]);
        }
    }
    return out.join('\n');
};

/******************************************************************************/

Matrix.prototype.fromString = function(text, append) {
    var matrix = append ? this : new Matrix();
    var textEnd = text.length;
    var lineBeg = 0, lineEnd;
    var line, pos;
    var fields, fieldVal;
    var switchName;
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

        // Less than 2 fields makes no sense
        if ( fields.length < 2 ) {
            continue;
        }

        fieldVal = fields[0];

        // Special directives:

        // title
        pos = fieldVal.indexOf('title:');
        if ( pos !== -1 ) {
            // TODO
            continue;
        }

        // Name
        pos = fieldVal.indexOf('name:');
        if ( pos !== -1 ) {
            // TODO
            continue;
        }

        // Switch on/off

        // `switch:` srcHostname state
        //      state = [`true`, `false`]
        switchName = '';
        if ( fieldVal === 'switch:' || fieldVal === 'matrix:' ) {
            fieldVal = 'matrix-off:';
        }
        pos = fieldVal.indexOf(':');
        if ( pos !== -1 ) {
            switchName = fieldVal.slice(0, pos);
        }
        if ( switchBitOffsets.hasOwnProperty(switchName) ) {
            srcHostname = punycode.toASCII(fields[1]);

            // No state field: reject
            fieldVal = fields[2];
            if ( fieldVal === null ) {
                continue;
            }
            // Unknown state: reject
            if ( nameToSwitchStateMap.hasOwnProperty(fieldVal) === false ) {
                continue;
            }

            matrix.setSwitch(switchName, srcHostname, nameToSwitchStateMap[fieldVal]);
            continue;
        }

        // Unknown directive
        pos = fieldVal.indexOf(':');
        if ( pos !== -1 ) {
            continue;
        }

        // Valid rule syntax:

        // srcHostname desHostname [type [state]]
        //      type = a valid request type
        //      state = [`block`, `allow`, `inherit`]

        // srcHostname desHostname type
        //      type = a valid request type
        //      state = `allow`

        // srcHostname desHostname
        //      type = `*`
        //      state = `allow`

        // Lines with invalid syntax silently ignored

        srcHostname = punycode.toASCII(fields[0]);
        desHostname = punycode.toASCII(fields[1]);

        fieldVal = fields[2];

        if ( fieldVal !== undefined ) {
            type = fieldVal;
            // Unknown type: reject
            if ( typeBitOffsets.hasOwnProperty(type) === false ) {
                continue;
            }
        } else {
            type = '*';
        }

        fieldVal = fields[3];

        if ( fieldVal !== undefined ) {
            // Unknown state: reject
            if ( nameToStateMap.hasOwnProperty(fieldVal) === false ) {
                continue;
            }
            state = nameToStateMap[fieldVal];
        } else {
            state = 2;
        }

        matrix.setCell(srcHostname, desHostname, type, state);
    }

    if ( !append ) {
        this.assign(matrix);
    }
};

/******************************************************************************/

Matrix.prototype.toSelfie = function() {
    return {
        magicId: magicId,
        switches: this.switches,
        rules: this.rules
    };
};

/******************************************************************************/

Matrix.prototype.fromSelfie = function(selfie) {
    this.switches = selfie.switches;
    this.rules = selfie.rules;
};

/******************************************************************************/

Matrix.prototype.diff = function(other, srcHostname, desHostnames) {
    var out = [];
    var desHostname, type;
    var switchName, i, thisVal, otherVal;
    for (;;) {
        for ( switchName in switchBitOffsets ) {
            if ( switchBitOffsets.hasOwnProperty(switchName) === false ) {
                continue;
            }
            thisVal = this.evaluateSwitch(switchName, srcHostname);
            otherVal = other.evaluateSwitch(switchName, srcHostname);
            if ( thisVal !== otherVal ) {
                out.push({
                    'what': switchName,
                    'src': srcHostname
                });
            }
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
        srcHostname = toBroaderHostname(srcHostname);
        if ( srcHostname === '' ) {
            break;
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
        if ( action.what === 'rule' ) {
            val = from.evaluateCell(action.src, action.des, action.type);
            changed = this.setCell(action.src, action.des, action.type, val) || changed;
            continue;
        }
        if ( switchBitOffsets.hasOwnProperty(action.what) ) {
            val = from.evaluateSwitch(action.what, action.src);
            changed = this.setSwitch(action.what, action.src, val) || changed;
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
