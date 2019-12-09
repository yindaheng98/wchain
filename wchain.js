/**
 * wchain-一个流式中间件调用框架*/

const StreamFaucet = require("./StreamFaucet");
const {Readable} = require("stream");
const OptionList = require("./OptionList");
const events = require("events");

/**
 * 构造函数，构造一个wchain变量
 * wchain既可以单独调用，也可以作为wchain的中间件（函数）
 * @param options wchain构造设置
 * @returns {Function}
 */
module.exports = function (options = OptionList) {

    options = JSON.parse(JSON.stringify(options));//二话不说先拷贝一份

    for (let key in OptionList)//统一设置
        if (options[key] === undefined)
            options[key] = OptionList[key];

    let middlewares = [];//中间件列表

    /**
     * 添加一个中间件，中间件将在run中按use的先后顺序被调用
     * 中间件的格式是一个函数function(meta, stream, next, emitter)，其参数为：
     * meta 立即返回的元数据
     * stream 输入流
     * next 调用下一个中间件的函数
     * emitter 从外部传入emitter，用于触发事件
     *
     * @param middleware 要添加的中间件
     *
     * 此函数将在后面成为wchain的成员函数
     */
    function use(middleware) {
        middlewares.push(middleware);
    }

    /**
     * 在一个stream上加水龙头
     * @param stream 输入一个stream
     * @returns {stream} 返回一个加了水龙头的stream
     */
    function make_faucet(stream) {//加水龙头
        if (options.pause_at_begin && stream instanceof Readable) {
            //如果需要在一开始就停止才加水龙头，不然不加
            let faucet = new StreamFaucet();
            faucet.pause();
            stream.pipe(faucet);
            stream = faucet;
        }
        return stream;
    }

    let chain = [];//chain是用于组装中间件调用链的循环变量
    let constructed = false;//标记chain构造是否完成

    /**
     * 用于构造调用链
     * 调用链是一个函数组成的数组，其入口是chain[0]
     * chain[0]有四个参数，其中meta和stream用于接收上一层的next参数传递到下一层，
     * emitter参数用于接收外部emitter，之后所有的事件都将在此emitter上触发
     * endi 指定第i个中间件end完成后调用的函数
     * @param next 指定调用链的最后一个next函数
     * @param async_run 指定是否使用异步模式
     */
    function construct(next, async_run) {
        if (constructed) return;//如果标记为已构造就直接返回
        chain = [];//没有构造过就构造
        chain[middlewares.length] = async_run ? (meta, stream, endi, emitter) => {
            next(meta, stream);
            emitter.emit("finish");//当使用异步模式的时候，调用链的末尾需要触发“完成”事件
        } : next;//不使用异步模式则不需要触发
        for (let i = middlewares.length - 1; i >= 0; i--) {
            //从调用链的末尾开始依次构造调用链（一级一级地定义流的流动顺序）
            chain[i] = async_run ? async (processedMeta, processedStream, endi, emitter) => {
                processedStream = make_faucet(processedStream);//在每一层中间加一个暂停的水龙头
                (async function () {//异步模式用异步封装
                    try {
                        await middlewares[i](
                            processedMeta,
                            processedStream,
                            (meta, stream) => chain[i + 1](meta, stream, endi, emitter),
                            () => endi(i));
                    } catch (e) {
                        emitter.emit("error", e);
                    }
                })()
            } : (processedMeta, processedStream, endi) => {//否则就直接用同步封装
                processedStream = make_faucet(processedStream);
                middlewares[i](processedMeta, processedStream, chain[i + 1], () => endi(i));
            };
        }
        constructed = true;//chain构造完成，设true
    }

    /**
     * get_endi用于构造一个endi(i)函数，此函数可以被多次调用
     * 每次调用endi(i)时，输入为一个整数i
     * 直到所有的i∈[0,n-1]都被输入一遍后，最后一次调用时get_endi的输入参数end将被调用
     * @param n 输入endi(i)的i的范围
     * @param end 所有的i都输入一遍后调用什么
     */
    function get_endi(n, end) {
        //ends用于记录每个中间件任务的完成情况（ends[i]的值表示endi(i)是否被调用）
        let ends = [], end_count = 0;

        function endi(i) {//当某个任务完成（end()被调用）后检查所有任务是否都已完成
            ends[i] = true;//将第i标志位置true
            end_count++;//end()计数
            if (end_count >= n) {//至少要被每个调用n次才可能全部完成
                for (let j = 0; j < n; j++)//依次扫描标志位
                    if (ends[j] !== true) return;//如果有一个不为true则说明有i没被输入过
                end();//全部为true则说明全部完成，调用最后的end()
            }
        }

        return endi;
    }

    /**
     * 运行wchain，即按顺序调用前面wchain.use添加的中间件
     * @param meta 输入立即返回的元数据
     * @param stream 输入流
     * @param next 最后一个中间件的next参量
     * @param end 在wchain中所有中间件的end全部被调用一遍后被调用的函数，表明中间件的流数据处理完成
     *
     * 此函数将在隔绝模式下成为wchain的成员函数，而非隔绝模式下的wchain不能直接调用此函数
     */
    function run(meta, stream, next = () => null, end = () => null) {
        //运行，按use的先后顺序调用中间件并传递触发器，其中的meta为非流式输入数据，stream为流式输入数据

        if (!options.async_meta) {//如果不使用异步模式
            construct(next, false);
            return chain[0](meta, stream, get_endi(middlewares.length, end));//那就简单点搞，直接构造
        }

        //如果使用异步模式，则返回一个Promise，在chain[0]完成后resolve，出错时reject
        let emitter = new events.EventEmitter();//每一次的run都是互相独立的，需要各自独立的emitter
        return new Promise((resolve, reject) => {//则返回一个Promise
            let isended = false;//停止标记，保证resolve/reject二者只调用一次
            emitter.once("error", (e) => {
                if (!isended) {
                    isended = true;//完成标记置true保证完成时只调用一次resolve
                    return reject(e);//在出错时reject
                }
                let strange_error = function (e) {
                    console.warn("A strange error occured after the run was finished: " + e);
                };
                strange_error(e);
                emitter.on("error", strange_error);//第一次之后的事件全部输出警告
            });
            emitter.once("finish", () => {
                if (!isended) {
                    isended = true;//完成标记置true保证完成时只调用一次resolve
                    return resolve();//在完成时resolve
                }
                let strange_finish = function () {
                    console.warn("A strange finish emitted after the run was finished");
                };
                strange_finish();
                emitter.on("finish", strange_finish);//第一次之后的事件全部输出警告
            });
            construct(next, true);
            chain[0](meta, stream, get_endi(middlewares.length, end), emitter);
        });
    }

    /**
     * 以中间件函数模式定义的wchain
     * @param meta 立即返回的元数据
     * @param stream 输入流
     * @param next 调用下一个中间件的函数
     * @param end 此中间件处理完成时调用的函数
     */
    function wchain(meta, stream, next, end) {
        //则使用内部定义的单独事件触发器（触发器的定义在下面）
        run(meta, stream, next, end);//其实就是运行
    }

    //wchain就是wchain
    wchain.run = run;
    wchain.use = use;

    return wchain
};