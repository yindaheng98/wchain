# wchain: a streaming process middleware system

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
* `next`: A function with 1 input. When you finished constructing your middleware, you **must** call this function. The input of this function is the meta data and stream you want to input to next middleware.
* `end`: A function with no input. In most cases, `next(meta, stream)` have been called in a middleware does not mean the process in the middleware was finished —— because the stream is asynchronous. You **must** call this function when the stream process is ended or wchain will not exit. Besides, if you are using event emitter, it is recommanded that when to call `end()` should be determine **before** call `next(meta, stream)`

Here are some example of defining a wchain middleware.

First is a very simple middleware to get a file path from the `meta` and read the file as a stream to next middleware:

```javascript
function Readfile(meta, stream, next, end) {
    let path = meta.file.path;
    stream = fs.createReadStream(path);
    stream.on("end", end);//When file is ended, call the end()
    next(meta, stream);//When the construction is over, call the next(meta, stream) to deliver the meta data and stream to next middleware
}
```

You will want to make some parameter of the middleware be constant, while others be variable. It is recommanded to define a construct function, and put the constant parameter in construct function, and put the variable parameter in `meta`. Just like this two middleware used for encrypt:

```javascript
const crypto = require("crypto");

function EncryptMiddleware(encoding) {//I want the encoding of the encryption being constant and not change in this middleware
    return function (meta, stream, next, end) {
        let meta_next = meta;
        meta = meta["encrypt"];
        let crypto_stream = crypto.createCipheriv(meta.algorithm, meta.key, meta.iv);//And I want the algorithm, the key, and the initial vector of the encryption being variable
        crypto_stream.on("end", () => {
            meta.onFinish(crypto_stream.final(encoding));
            end();
        });
        next(meta_next, stream.pipe(crypto_stream));
    }//The construct function construct a middleware and return it
}

function HashMiddleware(encoding) {
    return function (meta, stream, next, end) {
        let meta_next = meta;
        meta = meta["hash"];
        let hash_stream = crypto.createHash(meta.algorithm);
        stream.pipe(hash_stream);
        stream.on("end", () => {
            meta.onFinish(hash_stream.digest(encoding));
            end();
        });
        next(meta_next, stream);
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

After define a wchain, next step is to make it running. Run a wchain is also very easy, just call the method `run`, and input the meta and the stream.

The function `wchain.run` have 4 inputs, just like a middleware. In fact, a wchain can itself used as a wchain middleware, which means that you could run a wchain like a middleware, or use a wchain as a input of another wchain's `use` method. For example, if we have 4 input variables `meta`, `stream`, `next`, `end`:

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
try {
    crypto_wchain.run(meta, stream, next, end);
} catch (e) {
    console.log(e)
}
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

#### How if I want to include Promise or acync/await into a middleware?

Sometimes you would want to use some other asynchronous operations besides stream in middleware. For example, if I want to confirm that a file is exists before read the file, I will define a Promise function to determine the existance:

```javascript
function FileExists(path){
    return new Promise((resolve, reject) => {
        fs.stat(path,(err, stats) => {
            if (err) {
                if (err.code === "ENOENT")
                    return resolve(false);
                return reject(err);
            }
            return resolve(true);
        })
    })
}
```

Undoubted that `Readfile` middleware can be reformed the like this:

```javascript
function ReadfilePromise(meta, stream, next, end) {
    let path = meta.file.path;
    return new Promise((resolve, reject) => {
        FileExists(path).then((ex) => {
            if (ex) stream = fs.createReadStream(path);
            else return reject(new Error("File not exists!"));
            stream.on("end", end);
            next(meta, stream);
            return resolve();
        });
    })
}
```

Above from ES7, two powerful keywords was added: async/await. You could use async/await in middleware with ease:

```javascript
async function ReadfileAwait(meta, stream, next, end) {
    let path = meta.file.path;
    if (await FileExists(path)) {
        stream = fs.createReadStream(path);
    } else throw new Error("File not exists!");
    stream.on("end", end);
    next(meta, stream);
}
```

Promise is a significant and powerful feature of node. From wchain 1.2.0, wchain supports those middleware function that is defined a asynchronous operation and return a Promise. To use this feature, you should turn on the `async_meta` in options, like this:

```javascript
let crypto_wchain_Await = wchain({async_meta: true});//Options here
crypto_wchain_Await.use(ReadfileAwait);
crypto_wchain_Await.use(HashMiddleware("hex"));
crypto_wchain_Await.use(EncryptMiddleware("hex"));
meta.file.path = "not exists";
crypto_wchain_Await.run(meta, stream, next, end).catch(e => {
    console.log("catched!");
    console.log(e)
});
```

The `run` function in a wchain with `async_meta` turned on will return a Promise, and its `resolve` means that all the `next` functions have been called successfully in the wchain. You can also see it as that all the meta data haa been processed correctly because it will be called after the last `next` has been called (the last `next` function is what you input to `next` when call `wchain.run`).

### Change meta in middleware to shield low-level details or avoid error

For example, someone defined a middleware to write the stream into a file, but unfortunately, it use the same field in the meta with `Readfile` middleware:

```javascript
function FilewriteMiddleware() {
    return function (meta, stream, next, end) {
        meta = meta["file"];
        let write_stream = fs.createWriteStream(meta.path);
        stream.on("end", end);
        stream.pipe(write_stream);
        next(meta, stream);
    }
}
```

Now if you want to use this middleware to write the encrypt result into a file, but you cannot modify `FilewriteMiddleware`, without modify `Readfile`, how can you avoid error? The answer is, add a middleware to change meta between `crypto_wchain` and `FilewriteMiddleware`, in which change the `meta.file.path` into the path to write **before** call `next`:

```javascript
let another_wchain = wchain();
another_wchain.use(crypto_wchain);
another_wchain.use((meta, stream, next, end) => {
    meta.file.path = "test/result.txt";
    next(meta, stream);
    end();
});
another_wchain.use(FilewriteMiddleware());
```

Run the `another_wchain`, you will see the file was created correctly.

## One more thing

All the code above is the test code of this package. Run `npm test` to see the result.
