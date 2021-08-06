NProgress.configure({ parent: 'html' });

function progresserSearching(key, errors = 0) {
    $.ajax({
        type: "GET",
        async: true,
        url: "api/biu/get/status/",
        data: {
            'type': 'search',
            'key': key
        },
        success: function (rep) {
            rep = jQuery.parseJSON(JSON.stringify(rep));
            if (rep['code']) {
                now = 0;
                num = rep['msg']['rst'].length;
                for (let i = 0; i < num; i++) {
                    if (rep['msg']['rst'][i] === "done") {
                        now++;
                    }
                }
                srher = now / num;
            } else {
                NProgress.done();
                return;
            }

            if (srher !== 1) {
                NProgress.set(Number(srher));
                setTimeout("progresserSearching('" + key + "')", 500);
            } else {
                NProgress.done();
                return;
            }
        },
        error: function (e) {
            if (errors > 5) {
                console.log(e);
                return;
            }
            NProgress.done();
            setTimeout("progresserSearching('" + key + "', " + (errors + 1) + ")", 500);
        }
    });
}

function progresserDownloading_auto() {
    $.ajax({
        type: "GET",
        async: true,
        url: "api/biu/get/status/",
        data: {
            'type': 'download',
            'key': "__all__"
        },
        success: function (rep) {
            rep = jQuery.parseJSON(JSON.stringify(rep));
            let data = rep["msg"]["rst"];
            for (let key in downloadList) {
                let tmp = downloadList[String(key)];
                let hrefBak = tmp[0], errors = tmp[1];
                if (data.hasOwnProperty(key)) {
                    let tips = $('#dl_' + key + ' d');
                    let id = '#dl_' + key + ' d';
                    let thu = '#art_' + key + " a:first";
                    let num = 1, fin = 0, err = 0;

                    if ($(id).length <= 0)
                        continue

                    num = data[key].length;
                    for (let i = 0; i < num; i++) {
                        if (data[key][i] === "done")
                            fin++;
                        else if (data[key][i] === "failed")
                            err++;
                    }
                    srher = (fin + err) / num;

                    if (err > 0) {
                        $(thu).attr('class', 'image proer-error');
                        $(id).html('失败, 点击重试');
                        bakToDlHref(key, hrefBak);
                        continue;
                    }

                    if (srher === 1) {
                        $(thu).attr('class', 'image proer-done');
                        $(id).html('完成');
                        bakToDlHref(key, hrefBak);
                    } else {
                        $(thu).attr('class', 'image proer-dling');
                        if (tips.tooltipster('content') !== '取消下载') {
                            $('#dl_' + key).attr('href', `javascript: doDownloadStopPic('${key}');`);
                            tips.tooltipster('content', '取消下载');
                        }
                        if (num > 1)
                            $(id).html('下载中 ' + fin + '/' + num);
                        else
                            $(id).html('下载中');
                    }
                }
            }
            setTimeout(`progresserDownloading_auto()`, 1000);
        },
        error: function (e) {
            setTimeout(`progresserDownloading_auto()`, 3000);
        }
    });
}

function bakToDlHref(key, hrefBak) {
    delete downloadList[String(key)];
    $('#dl_' + key).attr('href', unescape(hrefBak).replaceAll("%sq%", "'").replaceAll("%dq%", "\""));
    $('#dl_' + key + ' d').tooltipster('content', "下载");
}