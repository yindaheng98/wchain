const {Transform} = require('stream');

class StreamFaucet extends Transform {
    _transform(chunk, encoding, callback) {
        callback();
        this.push(chunk);
    }
}

module.exports = StreamFaucet;