const wchain = require("./wchain");
const crypto = require("crypto");
const fs = require("fs");

function Readfile(meta, stream, next, end) {
    let path = meta.file.path;
    stream = fs.createReadStream(path);
    next(stream);
    stream.on("end", end);
}

function EncryptMiddleware(encoding) {
    return function (meta, stream, next, end) {
        meta = meta["encrypt"];
        let crypto_stream = crypto.createCipheriv(meta.algorithm, meta.key, meta.iv);
        crypto_stream.setEncoding(encoding);
        crypto_stream.on("end", () => {
            end();
        });
        next(stream.pipe(crypto_stream));
    }
}

function HashMiddleware(encoding) {
    return function (meta, stream, next, end) {
        meta = meta["hash"];
        let hash_stream = crypto.createHash(meta.algorithm);
        stream.pipe(hash_stream);
        stream.on("end", () => {
            meta.onFinish(hash_stream.digest(encoding));
            end();
        });
        next(stream);
    }
}

let crypto_wchain = wchain({pause_at_begin: false});
crypto_wchain.use(Readfile);
crypto_wchain.use(HashMiddleware("hex"));
crypto_wchain.use(EncryptMiddleware("hex"));

let meta = {
    file: {path: "test/test.txt"},
    hash: {
        algorithm: "md5",
        onFinish(h) {
            console.log("\nHash was finished. Here is the result: " + h)
        }
    },
    encrypt: {
        algorithm: "aes-128-cbc",
        key: "Here is the key.",
        iv: "I'm init vector."
    }
};
let stream = null;
let next = (stream) => {
    stream.pipe(process.stdout)
};
let end = () => {
    console.log("\nThe crypto_wchain was ended.")
};
crypto_wchain.run(meta, stream, next, end);


function FilewriteMiddleware() {
    return function (meta, stream, next, end) {
        meta = meta["file"];
        let write_stream = fs.createWriteStream(meta.path);
        stream.on("end", end);
        stream.pipe(write_stream);
        next(stream);
    }
}

let another_wchain = wchain();
another_wchain.use(crypto_wchain);
another_wchain.use((meta, stream, next, end) => {
    meta.file.path = "test/result.txt";
    next(stream);
    end();
});
another_wchain.use(FilewriteMiddleware());
another_wchain.run(meta, stream, next, () => {
    console.log("\nThe another_wchain was ended.")
});
