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

    for (let key in OptionList)//统一设置
        if (options[key] === undefined)
            options[key] = OptionList[key];

    let middlewares = [];//中间件列表
    let chain = [];//chain是用于组装中间件调用链的循环变量
    let constructed = false;//是否已完成构造

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
        constructed = false//每次添加中间件之后都需要重新构造
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

    /**
     * 用于构造调用链
     * @param next 指定调用链的最后一个next函数
     * @param endi 指定第i个中间件end完成后调用的函数
     * @param async_run 指定是否使用异步模式
     * @param emitter 指定异步代码内的错误和完成事件应该在何处触发
     */
    function construct(next, endi, async_run, emitter) {
        if (constructed) return;//如果已经构造过了就直接返回
        //没有构造过就构造
        chain[middlewares.length] = async_run ? (meta, stream) => {
            next(stream);
            emitter.emit("finish");//当使用异步模式的时候，调用链的末尾需要触发“完成”事件
        } : next;//不使用异步模式则不需要触发
        for (let i = middlewares.length - 1; i >= 0; i--) {
            //从调用链的末尾开始依次构造调用链（一级一级地定义流的流动顺序）
            chain[i] = async_run ? async (processedMeta, processedStream) => {
                processedStream = make_faucet(processedStream);//在每一层中间加一个暂停的水龙头
                (async function () {//异步模式用异步封装
                    try {
                        await middlewares[i](processedMeta, processedStream, chain[i + 1], () => endi(i));
                    } catch (e) {
                        emitter.emit("error", e);
                    }
                })()
            } : (processedMeta, processedStream) => {//否则就直接用同步封装
                processedStream = make_faucet(processedStream);
                middlewares[i](processedMeta, processedStream, chain[i + 1], () => endi(i));
            };
        }
        constructed = true;
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
        //运行，按use的先后顺序调用中间件并传递触发器，其中的meta为待处理的非流式数据

        //ends用于记录每个中间件任务的完成情况（end()是否被调用）
        let ends = [], end_count = 0;

        function endi(i) {//当某个任务完成（end()被调用）后检查所有任务是否都已完成
            ends[i] = true;//将第i标志位置true
            end_count++;//end()计数
            if (end_count >= middlewares.length)//end至少要被每个middlewares调用一次才可能全部完成
                for (let j = 0; j < middlewares.length; j++)//依次扫描标志位
                    if (ends[j] !== true) return;//如果有一个不为true则说明有中间件没完成
            end();//全部为true则说明全部完成，调用总的end()
        }

        if (options.async_meta) {//如果使用异步模式
            let emitter = new events.EventEmitter();
            return new Promise((resolve, reject) => {//则返回一个Promise
                emitter.on("error", reject);//在出错时reject
                emitter.on("finish", resolve);//在完成时resolve
                construct(next, endi, true, emitter);
                chain[0](meta, stream);
            });
        } else {
            construct(next, endi, false);
            return chain[0](meta, stream)
        }
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