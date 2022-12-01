function loadSearchSettings(mods = settingsMods) {
    const _cookie = Cookies.get();
    for (var id in mods) {
        if (!mods.hasOwnProperty(id)) continue;
        const name = mods[id][0]
        const arg = mods[id][1]
        const des = mods[id][2]
        tmpSearchSettings[name] = _cookie[name] ? _cookie[name] : arg;
        $(id).attr('placeholder', des + ': ' + tmpSearchSettings[name]);
    }
}

function saveSettingsCookie(reset = false, mods = settingsMods, only = null) {
    for (const id in mods) {
        if (!mods.hasOwnProperty(id)) continue;
        if (only !== null && !only.includes(id)) continue;
        const name = mods[id][0];
        if (reset) {
            Cookies.remove(name);
        } else if ($(id).val() != "") {
            Cookies.remove(name);
            Cookies.set(name, $(id).val(), { expires: 30, sameSite: "strict" });
        }
        $(id).val("");
    }
    loadSearchSettings(mods);
}

function loadFilters(mods = filtersMods) {
    const keys = Object.keys(mods);
    for (let i = 0; i < keys.length; i++) {
        const cookieID = mods[keys[i]][0];
        const cookie = Cookies.get();
        if (cookie[cookieID])
            tmpFilters[cookieID] = cookie[cookieID];
        else
            tmpFilters[cookieID] = "";
        if ($(keys[i]))
            $(keys[i]).val(tmpFilters[cookieID]);
    }
    if ($(".label-btn-filter")) {
        if (checkCookies(Object.keys(filtersMods), filtersMods))
            $(".label-btn-filter").addClass("weight-6");
        else
            $(".label-btn-filter").removeClass("weight-6");
    }
}

function saveFiltersCookie(reset = false, mods = filtersMods) {
    const keys = Object.keys(mods);
    for (let i = 0; i < keys.length; i++) {
        const cookieID = mods[keys[i]][0];
        const obj = $(keys[i]);
        Cookies.remove(cookieID);
        if (!reset && obj && obj.val())
            Cookies.set(cookieID, obj.val(), { expires: 7, sameSite: "strict" });
    }
    loadFilters(mods);
}

function checkCookies(li, mods = null) {
    const cookies = Cookies.get();
    for (let i = 0; i < li.length; i++) {
        const cookieID = !mods ? li[i] : mods[li[i]][0];
        if (cookies[cookieID])
            return true;
    }
    return false;
}