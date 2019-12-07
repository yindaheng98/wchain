# streams-processing-middleware

## Installation

This is a Node.js module available through the npm registry.

Installation is done using the npm install command:

```sh
npm install wchain
```

## Features

* Chaining stream processing by define series of middlewares
* Functional, nestable and easily-used middleware framework
* User-friendly APIs

## Useage

### How to define a wchain middleware

A wchain middleware is a function with 4 inputs:

* `meta`: A object. It contains all the input for the middleware except the stream input. It will been input by the user when the wchain running.
* `stream`: A stream. It is the stream input for the middleware. It will been input by previous middleware when the wchain running.
* `next`: A function with 1 input. When you finished constructing your middleware, you **must** call this function. The input of this function is the stream you want to input to next middleware.
* `end`: A function with no input. In most cases, `next(stream)` have been called in a middleware does not mean the process in the middleware was finished —— because the stream is asynchronous. You **must** call this function when the stream process is ended or wchain will not exit.

Here are some example of defining a wchain middleware.

First is a very simple middleware to get a file path from the `meta` and read the file as a stream to next middleware:

```javascript
function Readfile(meta, stream, next, end) {
    let path = meta.read_from;
    stream = fs.createReadStream(path);
    next(stream);//When the constructing is over, call the next(stream) to deliver the stream to next middleware
    stream.on("end", end);//When file is ended, call the end()
}
```

You will want to make some parameter of the middleware be constant, while others be variable. It is recommanded to define a construct function, and put the constant parameter in construct function, and put the variable parameter in `meta`. Just like this two middleware used for encrypt:

```javascript
const crypto = require("crypto");

function EncryptMiddleware(encoding) {//I want the encoding of the encryption being constant and not change in this middleware
    return function (meta, stream, next, end) {
        meta = meta["encrypt"];
        let crypto_stream = crypto.createCipheriv(meta.algorithm, meta.key, meta.iv);//And I want the algorithm, the key, and the initial vector of the encryption being variable
        crypto_stream.on("end", () => {
            meta.onFinish(crypto_stream.final(encoding));
            end();
        });
        next(stream.pipe(crypto_stream));
    }//The construct function construct a middleware and return it
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
```

### How to define a wchain and connect the middlewares

To define a wchain and connect the middlewares is very easy. For example, when I want to define a wchain and connect the three middlewares above, just import the package and call the method `use`:

```javascript
const wchain = require("./wchain");
let crypto_wchain = wchain();
crypto_wchain.use(Readfile);
crypto_wchain.use(HashMiddleware("hex"));
crypto_wchain.use(EncryptMiddleware("hex"));
```

That's it!

### How to run a wchain

After define a wchain, next step is to make it running. Run a wchain is also very easy, just call the mechod `run`, and input the meta and the stream.

The function `wchain.use` have 4 inputs, just like a middleware. In fact, a wchain can itself used as a wchain middleware, which means that you could run a wchain like a middleware, or use a wchain as a input of another wchain's `use` method. For example, if we have 4 input variables `meta`, `stream`, `next`, `end`:

```javascript
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
```

Then wchain `crypto_wchain` above can run using `wchain.run`, like this:

```javascript
crypto_wchain.run(meta, stream, next, end);
```

Or it can also run like a middleware:

```javascript
crypto_wchain(meta, stream, next, end);
```

The two above have exactly the same effect.

This feature make the wchain nestable. You can use the `crypto_wchain` just like a middleware and put it to another wchain:

```javascript
another_wchain.use(crypto_wchain);
```

### Change meta in middleware to shield details or avoid error

For example, someone defined a middleware to write the stream into a file, but unfortunately, it use the same field in the meta with `Readfile` middleware:

```javascript
function FilewriteMiddleware() {
    return function (meta, stream, next, end) {
        meta = meta["file"];
        let write_stream = fs.createWriteStream(meta.path);
        stream.on("end", end);
        stream.pipe(write_stream);
        next(stream);
    }
}
```

Now if you want to use this middleware to write the encrypt result into a file, but you cannot modify `FilewriteMiddleware`, without modify `Readfile`, how can you avoid error? The answer is, add a middleware to change meta between `crypto_wchain` and `FilewriteMiddleware`, in which change the `meta.file.path` into the path to write **before** call `next`:

```javascript
let another_wchain = wchain();
another_wchain.use(crypto_wchain);
another_wchain.use((meta, stream, next, end) => {
    meta.file.path = "test/result.txt";
    next(stream);
    end();
});
another_wchain.use(FilewriteMiddleware());
```

Run the `another_wchain`, you will see the file was created correctly.

## One more time

All the code above is the test code of this package. Run `npm test` to see the result.
