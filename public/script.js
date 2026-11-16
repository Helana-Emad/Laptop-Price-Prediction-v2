
var API_BASE_URL =
    (window.location.hostname === "localhost" ||
     window.location.hostname === "127.0.0.1")
        ? "http://127.0.0.1:8000"
        : "";


var FIELD_IDS = ["brand", "status", "cpu", "gpu", "ram", "storage", "storage_type", "screen", "touch"];

var form = document.getElementById("prediction-form");
var resultDiv = document.getElementById("result");

/* ---------- Fill the <select> elements from the API ---------- */

function populateSelect(elementId, items) {
    var select = document.getElementById(elementId);
    if (!select || !items) return;

    items.forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
    });
}

/* ---------- Searchable dropdown: type to filter OR click to choose ---------- */

function enhanceSelect(select) {
    if (!select || select.dataset.enhanced) return;
    select.dataset.enhanced = "true";
    select.required = false;        // validation is handled below
    select.style.display = "none";  // the real <select> stays in sync, hidden

    var wrap = document.createElement("div");
    wrap.className = "combo";

    var input = document.createElement("input");
    input.type = "text";
    input.id = select.id + "-input";
    input.className = "combo-input";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.placeholder = (select.options[0] ? select.options[0].text : "Select") + " or type";

    var list = document.createElement("ul");
    list.className = "combo-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;

    wrap.appendChild(input);
    wrap.appendChild(list);
    select.parentNode.insertBefore(wrap, select.nextSibling);

    var label = document.querySelector('label[for="' + select.id + '"]');
    if (label) label.htmlFor = input.id;

    var shown = [];
    var activeIndex = -1;

    function realOptions() {
        return Array.prototype.slice.call(select.options).filter(function (o) {
            return o.value !== "";
        });
    }

    function setActive(index) {
        var items = list.querySelectorAll(".combo-item");
        activeIndex = index;
        Array.prototype.forEach.call(items, function (el, i) {
            el.classList.toggle("active", i === index);
            if (i === index) el.scrollIntoView({ block: "nearest" });
        });
    }

    function close() {
        list.hidden = true;
        wrap.classList.remove("open");
        input.setAttribute("aria-expanded", "false");
        activeIndex = -1;
    }

    function choose(option) {
        select.value = option.value;
        input.value = option.text;
        wrap.classList.remove("invalid");
        close();
        select.dispatchEvent(new Event("change"));
    }

    function render(filter) {
        var q = (filter || "").trim().toLowerCase();
        shown = realOptions().filter(function (o) {
            return o.text.toLowerCase().indexOf(q) !== -1;
        });

        list.innerHTML = "";

        if (!shown.length) {
            var empty = document.createElement("li");
            empty.className = "combo-empty";
            empty.textContent = "No matches";
            list.appendChild(empty);
            return;
        }

        shown.forEach(function (o) {
            var li = document.createElement("li");
            li.className = "combo-item";
            li.setAttribute("role", "option");
            li.textContent = o.text;
            if (o.value === select.value) li.classList.add("selected");
            li.addEventListener("mousedown", function (e) {
                e.preventDefault();
                choose(o);
            });
            list.appendChild(li);
        });
    }

    function open(filter) {
        render(filter);
        list.hidden = false;
        wrap.classList.add("open");
        input.setAttribute("aria-expanded", "true");

        var selectedIndex = -1;
        shown.forEach(function (o, i) { if (o.value === select.value) selectedIndex = i; });
        setActive(filter ? (shown.length ? 0 : -1) : selectedIndex);
    }

    // do not lose focus when the user drags the list scrollbar
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });

    input.addEventListener("focus", function () {
        input.select();
        open("");
    });

    input.addEventListener("click", function () {
        if (list.hidden) open("");
    });

    input.addEventListener("input", function () {
        if (input.value.trim() === "") select.value = "";
        open(input.value);
    });

    input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (list.hidden) { open(""); return; }
            setActive(Math.min(activeIndex + 1, shown.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(activeIndex - 1, 0));
        } else if (e.key === "Enter") {
            if (!list.hidden) {
                e.preventDefault();
                if (activeIndex >= 0 && shown[activeIndex]) choose(shown[activeIndex]);
            }
        } else if (e.key === "Escape") {
            close();
        }
    });

    input.addEventListener("blur", function () {
        var q = input.value.trim().toLowerCase();
        var options = realOptions();

        if (q) {
            var exact = options.filter(function (o) { return o.text.toLowerCase() === q; })[0];
            var partial = options.filter(function (o) { return o.text.toLowerCase().indexOf(q) !== -1; });

            if (exact) choose(exact);
            else if (partial.length === 1) choose(partial[0]);
        }

        // keep the box showing only a valid choice
        var current = select.options[select.selectedIndex];
        input.value = select.value !== "" && current ? current.text : "";
        close();
    });

    document.addEventListener("click", function (e) {
        if (!wrap.contains(e.target)) close();
    });
}

function enhanceAll() {
    FIELD_IDS.forEach(function (id) {
        enhanceSelect(document.getElementById(id));
    });
}

/* ---------- Load options ---------- */

function loadOptions() {
    if (!form) return; // only run on predict.html

    fetch(API_BASE_URL + "/options")
        .then(function (response) {
            if (!response.ok) throw new Error("Server error " + response.status);
            return response.json();
        })
        .then(function (data) {
            FIELD_IDS.forEach(function (key) {
                populateSelect(key, data[key]);
            });
        })
        .catch(function (error) {
            console.error("Error loading options:", error);
            showError("Could not load the options. Start the FastAPI server and refresh the page.");
        })
        .then(enhanceAll);
}

/* ---------- Result helpers ---------- */

function selectedText(id) {
    var select = document.getElementById(id);
    return select.options[select.selectedIndex].text;
}

function showError(message) {
    resultDiv.className = "error";
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="result-price"></span>';
    resultDiv.querySelector(".result-price").textContent = message;
}

function showResult(result) {
    var price = Number(result.predicted_price);
    var formatted = isNaN(price)
        ? result.predicted_price
        : price.toLocaleString("en-US", { maximumFractionDigits: 0 });

    resultDiv.className = "";
    resultDiv.style.display = "block";
    resultDiv.innerHTML =
        '<span class="result-label">Estimated price</span>' +
        '<span class="result-price"></span>' +
        '<span class="result-model">Closest model: <b></b></span>';

    resultDiv.querySelector(".result-price").textContent = "$" + formatted;
    resultDiv.querySelector(".result-model b").textContent = result.name || "N/A";
}

function setLoading(isLoading) {
    var button = form.querySelector(".predict-button");
    var label = button.querySelector("span");
    var icon = button.querySelector("i");

    button.disabled = isLoading;
    button.classList.toggle("loading", isLoading);
    label.textContent = isLoading ? "Calculating..." : "Predict Laptop Price";
    icon.className = isLoading ? "fas fa-spinner" : "fas fa-arrow-right";
}

/* ---------- Submit ---------- */

function validateForm() {
    for (var i = 0; i < FIELD_IDS.length; i++) {
        var select = document.getElementById(FIELD_IDS[i]);
        if (select.value === "") {
            var input = document.getElementById(FIELD_IDS[i] + "-input");
            var label = document.querySelector('label[for="' + FIELD_IDS[i] + '-input"]');
            if (input) {
                input.parentNode.classList.add("invalid");
                input.focus();
            }
            showError("Please choose a value for " + (label ? label.textContent : FIELD_IDS[i]) + ".");
            return false;
        }
    }
    return true;
}

if (form) {
    form.addEventListener("submit", function (event) {
        event.preventDefault();

        if (!validateForm()) return;

        var payload = {
            brand: document.getElementById("brand").value,
            cpu: document.getElementById("cpu").value,
            gpu: document.getElementById("gpu").value,
            storage_type: document.getElementById("storage_type").value,
            ram: Number(document.getElementById("ram").value),
            storage: selectedText("storage"),
            screen: Number(document.getElementById("screen").value),
            status: selectedText("status").toLowerCase(),
            touch: selectedText("touch").toLowerCase()
        };

        setLoading(true);

        fetch(API_BASE_URL + "/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
            .then(function (response) {
                if (!response.ok) throw new Error("Server error " + response.status);
                return response.json();
            })
            .then(showResult)
            .catch(function (error) {
                console.error(error);
                showError("Prediction failed. Make sure the FastAPI server is running.");
            })
            .then(function () {
                setLoading(false);
            });
    });
}

window.addEventListener("load", loadOptions);