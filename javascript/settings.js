var Settings = {
    currentUrl: "",
    executeScriptRegex: /^about:|^brave:|^chrome:|^edge:|^opera:|^vivaldi:|^https:\/\/(chromewebstore|addons)|.*extension:/i,
    CHARSET_OPTIONS: [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`~!@#$%^&*()_-+={}|[]\\:\";'<>?,./",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        "0123456789abcdef",
        "0123456789",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "`~!@#$%^&*()_-+={}|[]\\:\";'<>?,./"
    ],
    lastmod: 0
};

Settings.getProfileById = (id) => {
    return Settings.profiles.filter((profile) => profile.id === parseInt(id, 10))[0];
};

Settings.getProfileByTitle = (str) => {
    return Settings.profiles.filter((profile) => profile.title === str)[0];
};

Settings.addProfile = (inputProfile) => {
    inputProfile.id = Settings.profiles.reduce((prev, curr) => Math.max((prev.id || 0), curr.id), 0) + 1;
    Settings.profiles.push(inputProfile);
};

Settings.deleteProfile = (id) => {
    Settings.profiles = Settings.profiles.filter((profile) => profile.id !== parseInt(id, 10));
    Settings.saveProfiles();
};

Settings.loadProfilesFromString = (profiles) => {
    Settings.profiles = JSON.parse(profiles).map((item) => Object.assign(new Profile(), item));
};

Settings.loadProfiles = () => {
    return chrome.storage.local.get(["profiles", "sync_profiles", "synced_profiles", "sync_profiles_password"]).then((result) => {
        if (result["sync_profiles"] && result["synced_profiles"] && result["sync_profiles_password"]) {
            if (result["synced_profiles"]) {
                chrome.storage.local.set({ "syncDataAvailable": true });
            }
            var profiles = Settings.decrypt(result["sync_profiles_password"], result["synced_profiles"]);
            if (profiles.length !== 0) {
                Settings.loadProfilesFromString(profiles);
            }
        } else if (result["profiles"]) {
            Settings.loadProfilesFromString(result["profiles"]);
        } else {
            var normal = new Profile();
            var alpha = new Profile();
            alpha.id = 2;
            alpha.title = "Alphanumeric";
            alpha.selectedCharset = Settings.CHARSET_OPTIONS[1];
            Settings.profiles = [normal, alpha];
            Settings.saveProfiles();
        }
    }).catch((err) => console.trace(`Could not run Settings.loadProfiles: ${err}`));
}

Settings.sortProfiles = (sortOrder) => {
    var profiles = Settings.profiles,
        defaultProfile = profiles.shift();
    switch (sortOrder) {
        case "user_defined":
            break;
        case "alphabetical":
            profiles.sort((a, b) => {
                if (a.title.toUpperCase() < b.title.toUpperCase()) return -1;
                if (a.title.toUpperCase() > b.title.toUpperCase()) return 1;
                return 0;
            });
            break;
        case "newest_first":
            profiles.sort((a, b) => {
                return b.timestamp - a.timestamp;
            });
            break;
        case "oldest_first":
            profiles.sort((a, b) => {
                return a.timestamp - b.timestamp;
            });
            break;
        default:
            console.trace(`Incorrect Settings.sortProfiles option: ${sortOrder}`);
            break;
    }
    profiles.unshift(defaultProfile);
    Settings.profiles = profiles;
};

Settings.saveSyncedProfiles = (syncPassHash, profileData) => {
    var threshold = Math.round(8192 * 0.99); // 8192 is chrome.storage.sync.QUOTA_BYTES_PER_ITEM but 8146 is actual max item size

    return chrome.storage.sync.clear().then(() => {
        if (profileData.length <= threshold) {
            return chrome.storage.sync.set({ "synced_profiles": profileData })
                .then(() => chrome.storage.local.set({ "syncDataAvailable": true, "synced_profiles": profileData, "sync_profiles_password": syncPassHash }))
                .catch((err) => console.trace(`Could not sync small data: ${err}`));
        } else {
            var splitter = new RegExp("[\\s\\S]{1," + threshold + "}", "g");
            var parts = profileData.match(splitter);
            var date = Date.now();
            var output = {};
            var keys = [];

            parts.forEach((part, index) => {
                output[date + index] = part;
                keys[index] = date + index;
            });

            output["synced_profiles_keys"] = keys;
            return chrome.storage.sync.set(output)
                .then(() => chrome.storage.local.set({ "syncDataAvailable": true, "synced_profiles": profileData, "sync_profiles_password": syncPassHash }))
                .catch((err) => console.trace(`Could not sync large data: ${err}`));
        }
    }).catch((err) => console.trace(`Could not sync anything: ${err}`));
};

Settings.saveProfiles = () => {
    Settings.profiles = Settings.profiles.map((profile, index) => {
        profile.id = index + 1;
        return profile;
    });

    var stringified = JSON.stringify(Settings.profiles);
    return chrome.storage.local.set({ "profiles": stringified }).then(() => {
        return chrome.storage.local.get(["sync_profiles", "syncDataAvailable", "sync_profiles_password", "synced_profiles"]).then((result) => {
            var syncHash = result["sync_profiles_password"] || "";
            var profiles = Settings.decrypt(syncHash, result["synced_profiles"]);
            if (result["sync_profiles"] && (!result["syncDataAvailable"] || (profiles.length !== 0))) {
                return Settings.saveSyncedProfiles(result["sync_profiles_password"], Settings.encrypt(result["sync_profiles_password"], stringified));
            }
        });
    }).catch((err) => console.trace(`Could not run Settings.saveProfiles: ${err}`));
};

Settings.setStoreLocation = (location) => {
    chrome.storage.local.set({ "storeLocation": location }).then(() => {
        switch (location) {
            case "memory":
                chrome.storage.local.remove(["expire_password_minutes", "password", "password_crypt", "password_key"]);
                break;
            case "memory_expire":
                chrome.storage.local.remove(["expire_password_minutes", "password", "password_crypt", "password_key"])
                    .then(() => chrome.storage.local.set({ "expire_password_minutes": 5 }));
                break;
            case "disk":
                chrome.storage.session.remove(["password", "password_key"])
                    .then(() => chrome.storage.local.remove(["expire_password_minutes"]));
                break;
            case "never":
                chrome.storage.session.remove(["password", "password_key"])
                    .then(() => chrome.storage.local.remove(["expire_password_minutes", "password", "password_crypt", "password_key"]));
                break;
        }
    }).catch((err) => console.trace(`Could not run Settings.setStoreLocation: ${err}`));
};

Settings.createExpirePasswordAlarm = () => {
    chrome.alarms.clear("expire_password").then(() => {
        return chrome.storage.local.get(["expire_password_minutes"]);
    }).then((result) => {
        chrome.alarms.create("expire_password", {
            delayInMinutes: parseInt(result["expire_password_minutes"])
        });
    }).catch((err) => console.trace(`Could not run Settings.createExpirePasswordAlarm: ${err}`));
};

Settings.make_pbkdf2 = (password, previousSalt, iter) => {
    var usedSalt = previousSalt || sjcl.codec.base64.fromBits(crypto.getRandomValues(new Uint32Array(8)));
    var iterations = iter || 10000;
    var derived = sjcl.codec.hex.fromBits(sjcl.misc.pbkdf2(password, usedSalt, iterations));
    return {
        hash: derived,
        salt: usedSalt,
        iter: iterations
    };
};

Settings.encrypt = (key, data) => {
    return sjcl.encrypt(key, data, {
        ks: 256,
        ts: 128
    });
};

Settings.decrypt = (key, data) => {
    try {
        return sjcl.decrypt(key, data);
    } catch (e) {
        return "";
    }
};

// strength calculation based on Firefox version to return an object
Settings.getPasswordStrength = (pw) => {
    // char frequency
    var uniques = new Set();
    Array.from(pw).forEach((char) => {
        uniques.add(char.charCodeAt(0));
    });
    var r0 = (uniques.size === 1) ? 0 : (uniques.size / pw.length);

    // length of the password - 1pt per char over 5, up to 15 for 10 pts total
    var r1 = pw.length;
    switch (true) {
        case (r1 >= 15):
            r1 = 10; break;
        case (r1 < 5):
            r1 = -5; break;
        default:
            r1 -= 5;
    }

    var quarterLen = Math.round(pw.length / 4);

    // ratio of numbers in the password
    var c = pw.replace(/[0-9]/g, "");
    var nums = (pw.length - c.length);
    c = nums > quarterLen * 2 ? quarterLen : Math.abs(quarterLen - nums);
    var r2 = 1 - (c / quarterLen);

    // ratio of symbols in the password
    c = pw.replace(/\W/g, "");
    var syms = (pw.length - c.length);
    c = syms > quarterLen * 2 ? quarterLen : Math.abs(quarterLen - syms);
    var r3 = 1 - (c / quarterLen);

    // ratio of uppercase in the password
    c = pw.replace(/[A-Z]/g, "");
    var upper = (pw.length - c.length);
    c = upper > quarterLen * 2 ? quarterLen : Math.abs(quarterLen - upper);
    var r4 = 1 - (c / quarterLen);

    // ratio of lowercase in the password
    c = pw.replace(/[a-z]/g, "");
    var lower = (pw.length - c.length);
    c = lower > quarterLen * 2 ? quarterLen : Math.abs(quarterLen - lower);
    var r5 = 1 - (c / quarterLen);

    var pwStrength = (((r0 + r2 + r3 + r4 + r5) / 5) * 100) + r1;

    // make sure strength is a valid value between 0 and 100
    if (pwStrength < 0 || isNaN(pwStrength)) pwStrength = 0;
    if (pwStrength > 100) pwStrength = 100;

    // return strength as an integer + boolean usage of character type
    return {
        strength: parseInt(pwStrength, 10),
        hasUpper: Boolean(upper),
        hasLower: Boolean(lower),
        hasDigit: Boolean(nums),
        hasSymbol: Boolean(syms)
    };
};

Settings.migrateStorage = () => {
    return chrome.storage.local.get(["alpha_sort_profiles", "sort_profiles"]).then((result) => {
        if (result["alpha_sort_profiles"] === true) {
            chrome.storage.local.set({ "sort_profiles": "alphabetical" })
                .then(() => chrome.storage.local.remove(["alpha_sort_profiles"]));
        } else if (result["sort_profiles"] === undefined) {
            chrome.storage.local.set({ "sort_profiles": "user_defined" });
        }
    });
}
