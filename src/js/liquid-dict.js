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

µMatrix.LiquidDict = (( ) => {

/******************************************************************************/

var LiquidDict = function() {
    this.dict = new Map();
    this.reset();
};

/******************************************************************************/

// Somewhat arbitrary: I need to come up with hard data to know at which
// point binary search is better than indexOf.

LiquidDict.prototype.cutoff = 500;

/******************************************************************************/

var meltBucket = function(ldict, len, bucket) {
    ldict.frozenBucketCount -= 1;
    if ( bucket.charCodeAt(0) === 0x20 /* ' ' */ ) {
        return new Set(bucket.trim().split(' '));
    }
    let dict = new Set();
    let offset = 0;
    while ( offset < bucket.length ) {
        dict.add(bucket.substring(offset, len));
        offset += len;
    }
    return dict;
};

var freezeBucket = function(ldict, bucket) {
    ldict.frozenBucketCount += 1;
    let words = Array.from(bucket);
    let wordLen = words[0].length;
    if ( wordLen * words.length < ldict.cutoff ) {
        return ' ' + words.join(' ') + ' ';
    }
    return words.sort().join('');
};

/******************************************************************************/

// How the key is derived dictates the number and size of buckets.
//
// http://jsperf.com/makekey-concat-vs-join/3
//
// Question: Why is using a prototyped function better than a standalone
// helper function?

LiquidDict.prototype.makeKey = function(word) {
    let len = word.length;
    if ( len > 255 ) { len = 255; }
    let i = len >> 2;
    return (word.charCodeAt(    0) & 0x03) << 14 |
           (word.charCodeAt(    i) & 0x03) << 12 |
           (word.charCodeAt(  i+i) & 0x03) << 10 |
           (word.charCodeAt(i+i+i) & 0x03) <<  8 |
           len;
};

/******************************************************************************/

LiquidDict.prototype.test = function(word) {
    let key = this.makeKey(word);
    let bucket = this.dict.get(key);
    if ( bucket === undefined ) {
        return false;
    }
    if ( typeof bucket === 'object' ) {
        return bucket.has(word);
    }
    if ( bucket.charCodeAt(0) === 0x20 /* ' ' */ ) {
        return bucket.indexOf(' ' + word + ' ') !== -1;
    }
    // binary search
    let len = word.length;
    let left = 0;
    // http://jsperf.com/or-vs-floor/3
    let right = ~~(bucket.length / len + 0.5);
    while ( left < right ) {
        let i = left + right >> 1;
        let needle = bucket.substr( len * i, len );
        if ( word < needle ) {
            right = i;
        } else if ( word > needle ) {
            left = i + 1;
        } else {
            return true;
        }
    }
    return false;
};

/******************************************************************************/

LiquidDict.prototype.add = function(word) {
    let key = this.makeKey(word);
    let bucket = this.dict.get(key);
    if ( bucket === undefined ) {
        bucket = new Set();
        this.dict.set(key, bucket);
        bucket.add(word);
        this.count += 1;
        return true;
    }
    if ( typeof bucket === 'string' ) {
        bucket = meltBucket(this, word.len, bucket);
        this.dict.set(key, bucket);
    }
    if ( bucket.has(word) === false ) {
        bucket.add(word);
        this.count += 1;
        return true;
    }
    this.duplicateCount += 1;
    return false;
};

/******************************************************************************/

LiquidDict.prototype.freeze = function() {
    for ( let entry of this.dict ) {
        if ( typeof entry[1] === 'object' ) {
            this.dict.set(entry[0], freezeBucket(this, entry[1]));
        }
    }
};

/******************************************************************************/

LiquidDict.prototype.reset = function() {
    this.dict.clear();
    this.count = 0;
    this.duplicateCount = 0;
    this.frozenBucketCount = 0;
};

/******************************************************************************/

const selfieVersion = 1;

LiquidDict.prototype.toSelfie = function() {
    this.freeze();
    return {
        version: selfieVersion,
        count: this.count,
        duplicateCount: this.duplicateCount,
        frozenBucketCount: this.frozenBucketCount,
        dict: Array.from(this.dict)
    };
};

LiquidDict.prototype.fromSelfie = function(selfie) {
    if ( selfie.version !== selfieVersion ) { return false; }
    this.count = selfie.count;
    this.duplicateCount = selfie.duplicateCount;
    this.frozenBucketCount = selfie.frozenBucketCount;
    this.dict = new Map(selfie.dict);
    return true;
};

/******************************************************************************/

return LiquidDict;

/******************************************************************************/

})();

/******************************************************************************/

µMatrix.ubiquitousBlacklist = new µMatrix.LiquidDict();
