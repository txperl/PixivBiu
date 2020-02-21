NProgress.configure({ parent: 'html' });

function progresserSearching(key, errors = 0) {
    $.ajax({
        type: "GET",
        async: true,
        url: "api/biu/get/status",
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
                    if (rep['msg']['rst'][i] === true) {
                        now++;
                    }
                }
                srher = now / num;
            } else {
                NProgress.done();
                return;
            }

            if (srher != 1) {
                NProgress.set(Number(srher));
                setTimeout("progresserSearching('" + key + "')", 200);
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
            setTimeout("progresserSearching('" + key + "', " + (errors + 1) + ")", 200);
        }
    });
}

function progresserDownloading(key, errors = 0) {
    $.ajax({
        type: "GET",
        async: true,
        url: "api/biu/get/status",
        data: {
            'type': 'download',
            'key': key
        },
        success: function (rep) {
            rep = jQuery.parseJSON(JSON.stringify(rep));
            var id = '#dl_' + key + ' d';
            var thu = '#art_' + key + " a:first";
            var num = 1;
            var fin = 0;
            var err = 0;

            if (rep['code']) {
                num = rep['msg']['rst'].length;
                for (let i = 0; i < num; i++) {
                    if (rep['msg']['rst'][i] === true) {
                        fin++;
                    } else if (rep['msg']['rst'][i] === false) {
                        err++;
                    }
                }
                srher = (fin + err) / num;
            } else {
                return;
            }

            if (err > 0) {
                if ($(id).length > 0) {
                    $(thu).attr('class', 'image proer-error');
                    $(id).html('失败, 点击重试');
                }
                return;
            }

            if (srher == 1) {
                if ($(id).length > 0) {
                    $(thu).attr('class', 'image proer-done');
                    $(id).html('完成');
                } else {
                    waitToChangeHTML(key, '完成');
                }
                return;
            } else {
                if (num > 1) {
                    if ($(id).length > 0) {
                        $(thu).attr('class', 'image proer-dling');
                        $(id).html('下载中 ' + fin + '/' + num);
                    }
                } else {
                    if ($(id).length > 0) {
                        $(thu).attr('class', 'image proer-dling');
                        $(id).html('下载中');
                    }
                }
                setTimeout("progresserDownloading('" + key + "')", 500);
            }
        },
        error: function (e) {
            if (errors > 5) {
                console.log(e);
                if ($(id).length > 0) {
                    $(thu).attr('class', 'image proer-error');
                    $(id).html('错误, 点击重试');
                } else {
                    waitToChangeHTML(key, '错误, 点击重试', 'error');
                }
                return;
            }
            setTimeout("progresserDownloading('" + key + "', " + (errors + 1) + ")", 500);
        }
    });
}

function waitToChangeHTML(key, c, css = 'done') {
    var id = '#dl_' + key + ' d';
    var thu = '#art_' + key + " a:first";
    if ($(id).length > 0) {
        $(thu).attr('class', 'image proer-' + css);
        $(id).html(c);
        return;
    } else {
        setTimeout("waitToChangeHTML('" + key + "', '" + c + "', '" + css + "')", 1000);
    }
}