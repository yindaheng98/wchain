/**
 * wchain-一个流式中间件调用框架*/

const StreamFaucet = require("./StreamFaucet");
const {Readable} = require("stream");
const OptionList = require("./OptionList");

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
        middlewares.push(middleware)
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
        //chain是用于组装中间件调用链的循环变量
        let chain = [], ends = [];
        chain[middlewares.length] = next;//调用链的末尾是下一个调用链
        for (let i = middlewares.length - 1; i >= 0; i--) {
            //从调用链的末尾开始依次构造调用链（一级一级地定义流的流动顺序）
            chain[i] = async (processedStream) => {
                if (options.pause_at_begin && processedStream instanceof Readable) {//如果需要在一开始就停止
                    //那就在每一层中间加一个暂停的水龙头
                    let faucet = new StreamFaucet();
                    faucet.pause();
                    processedStream.pipe(faucet);
                    processedStream = faucet;
                }
                await middlewares[i](meta, processedStream, chain[i + 1],
                    () => {
                        ends[i] = true;//将第i标志位置true
                        for (let j = 0; j < middlewares.length; j++)//依次扫描标志位
                            if (ends[j] !== true) return;//如果有一个不为true则说明有中间件没完成
                        end();//全部为true则说明全部完成
                    });
            };
        }
        chain[0](stream).catch((e) => {
            throw e
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