const blockMain = new Vue({
    el: "#main",
    data: {
        advice_block_list: []
    },
    created: function () { },
    mounted: function () { },
    delimiters: ["[[", "]]"],
    watch: {},
    methods: {
        searchImage(event) {
            const image = event.target.files[0];
            const reader = new FileReader();
            $("#title-block-searchImage").text("🔍 图片搜索中...");
            reader.readAsDataURL(image);
            reader.onload = (e) => {
                $("#preview-searchImage").css("background-image", `url(${e.target.result})`);
            };
            let data = new FormData();
            data.append("image", image);
            const vm = this;
            axios.post("api/biu/search/images/", data).then(rep => {
                const content = rep.data.code === 1 ? rep.data.msg.rst : {};
                if (Object.keys(content).includes("results") && content.results.length > 0) {
                    $("#srhBox").val(`@w=${content.results[0].data.pixiv_id}`);
                    srhBoxDo();
                } else {
                    if (rep.data.msg.includes("offline"))
                        vm.advice_block_list = ["若要使用图片搜索功能，必须设置", "secret.key.apiSauceNAO", "你可以在配置文件的末尾找到它"];
                    else if (rep.data.msg.includes("wrong"))
                        vm.advice_block_list = ["设置的 SauceNAO API Key 错误"];
                    else if (rep.data.msg.includes("plugin"))
                        vm.advice_block_list = ["程序错误，可能是由于网络问题所致", "请重新尝试"];
                    else
                        vm.advice_block_list = [rep.data.msg];
                    $("#title-block-searchImage").text("搜索失败，可以查看左侧建议中的可能原因");
                    $("#codeBox .pop_ctrl").click()
                }
            }, err => {
                $("#title-block-searchImage").text("搜索失败，原因未知");
            });
        }
    }
});