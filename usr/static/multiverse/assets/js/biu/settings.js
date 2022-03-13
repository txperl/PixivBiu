function loadSearchSettings(mods = settingsMods) {
    for (var id in mods) {
        if (!mods.hasOwnProperty(id)) continue;

        var name = mods[id][0]
        var arg = mods[id][1]
        var des = mods[id][2]
        var cokie = Cookies.get();

        if (cokie[name]) {
            tmpSearchSettings[name] = cokie[name]
        } else {
            tmpSearchSettings[name] = arg
        }

        $(id).attr('placeholder', des + ': ' + tmpSearchSettings[name]);
    }
}

function saveSettingsCookie(mods = settingsMods) {
    for (var id in mods) {
        if (!mods.hasOwnProperty(id)) continue;

        if ($(id).val() != "") {
            var name = mods[id][0]
            Cookies.remove(name);
            Cookies.set(name, $(id).val(), { expires: 7 })
            $(id).val('');
        }
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
}

function saveFiltersCookie(reset = false, mods = filtersMods) {
    const keys = Object.keys(mods);
    for (let i = 0; i < keys.length; i++) {
        const cookieID = mods[keys[i]][0];
        const obj = $(keys[i]);
        Cookies.remove(cookieID);
        if (!reset && obj && obj.val())
            Cookies.set(cookieID, obj.val(), { expires: 7 })
    }
    loadFilters(mods);
}