const OptionList = {

    /**
     * 启动时是否暂停流
     * 此项为false时，wchain会在层与层之间加水龙头（一个简单的Transform流），使用node流的背压原理控制流的启停
     * 并且把恢复流动的操作放在调用链中的最后一个next函数中
     *
     * 说明：
     * 通常情况下，stream在第一个pipe被调用时就开始流动了
     * 如果您写的某些中间件共用了一个输入stream，而又有stream.pipe()放在了异步操作中
     * 则异步操作中的pipe的实际调用在stream开始流动之后
     * 这时，这些异步操作中stream.pipe()的流可能在源头stream已经流走了几个数据之后才开始读取，从而出现数据丢失
     * 因此本框架设计了水龙头机制，阻止这种情况的发生
     * 但是这种处理方式毫无疑问会占用更多内存空间，因此，
     * 当您确信系统中没有多个中间件复用一个流或者没有任何stream.pipe()在异步操作中时，请将此项设为false
     *
     * 原理：
     * 在每一层中间件的next函数中，将中间件输出的stream pipe到一个状态为pause的Transform流中，
     * 并将这个Transform流代替上一层中间件输出的stream作为下一层中间件的输入stream
     * 于是，这个流会一直pause直到下一层调用了它的pipe
     *
     * 注意：
     * 中间件中的stream.pipe可以在一个异步里面，但是stream.pipe和它的next()必须是同步的
     * 如果一个中间件中的stream.pipe和它的next()都不是同步调用的话，那就真的没办法了
     */
    pause_at_begin: true
};

module.exports = OptionList;