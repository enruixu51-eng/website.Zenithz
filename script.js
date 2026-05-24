let reminders = JSON.parse(localStorage.getItem('zenith_reminders')) || [];
let allTimezones = []; 

let colorTags = JSON.parse(localStorage.getItem('zenith_color_tags')) || [
    { color: '#34d399', label: 'Normal' },
    { color: '#facc15', label: 'Important' },
    { color: '#ef4444', label: 'Urgent' },
    { color: '#a78bfa', label: 'Custom' }
];
localStorage.setItem('zenith_color_tags', JSON.stringify(colorTags));

let selectedColor = colorTags[0].color;
let calDate = new Date();
let selectedDateStr = `${calDate.getFullYear()}-${(calDate.getMonth()+1).toString().padStart(2,'0')}-${calDate.getDate().toString().padStart(2,'0')}`;

if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
}

let targetAlarm = null, alarmSound = new Audio(), isRinging = false;
let tmInterval, isRunning = false, timeLeft = 0;

let isAdvancedTomato = false;
let advancedCurrentIndex = -1;
let tomatoTimeline = JSON.parse(localStorage.getItem('zenith_tomato_timeline')) || [
    { id: 1, name: 'Deep Work', mins: 25 },
    { id: 2, name: 'Short Rest', mins: 5 },
    { id: 3, name: 'Deep Work', mins: 25 },
    { id: 4, name: 'Long Rest', mins: 15 }
];
let draggedItemIndex = null;

function initSelectors() {
    const sets = [{h:'alarm-h', m:'alarm-m', s:'alarm-s'}, {h:'tomato-h', m:'tomato-m', s:'tomato-s'}];
    sets.forEach(set => {
        const h = document.getElementById(set.h), m = document.getElementById(set.m), s = document.getElementById(set.s);
        if(!h || !m) return;
        for(let i=0; i<24; i++) h.add(new Option(i.toString().padStart(2,'0'), i));
        for(let i=0; i<60; i++) m.add(new Option(i.toString().padStart(2,'0'), i));
        if(s) for(let i=0; i<60; i++) s.add(new Option(i.toString().padStart(2,'0'), i));
        if(set.h.includes('tomato')) {
            h.onchange = m.onchange = s.onchange = () => { if(!isRunning) { timeLeft = 0; updateTomatoPreview(); } };
        }
    });

    const remH = document.getElementById('remind-h');
    const remM = document.getElementById('remind-m');
    if(remH && remM) {
        for(let i=1; i<=12; i++) remH.add(new Option(i.toString().padStart(2,'0'), i.toString().padStart(2,'0')));
        for(let i=0; i<60; i++) remM.add(new Option(i.toString().padStart(2,'0'), i.toString().padStart(2,'0')));
    }

    const tzSelect = document.getElementById('tz-select');
    if (tzSelect) {
        try {
            const timeZones = Intl.supportedValuesOf('timeZone');
            allTimezones = timeZones.map(tz => {
                let parts = tz.split('/');
                let city = parts[parts.length - 1].replace(/_/g, ' ');
                let region = parts[0];
                return { value: tz, city: city, region: region };
            });
            allTimezones.sort((a, b) => a.city.localeCompare(b.city));
            renderTimezones(''); 
            renderWeatherCities(''); 
        } catch (e) { console.log("Timezone API not fully supported."); }
    }
}

function renderTimezones(filterText) {
    const tzSelect = document.getElementById('tz-select');
    if(!tzSelect) return;
    tzSelect.innerHTML = '<option value="local">📍 Local Time</option>';
    const lowerFilter = filterText.toLowerCase();
    allTimezones.forEach(opt => {
        if(opt.city.toLowerCase().includes(lowerFilter) || opt.region.toLowerCase().includes(lowerFilter)) {
            tzSelect.add(new Option(`${opt.city} (${opt.region})`, opt.value));
        }
    });
}
function filterTimezones() {
    const val = document.getElementById('tz-search').value;
    renderTimezones(val);
    const tzSelect = document.getElementById('tz-select');
    if (val.trim() !== '' && tzSelect.options.length > 1) { tzSelect.selectedIndex = 1; }
}

function renderWeatherCities(filterText) {
    const wSelect = document.getElementById('weather-city-select');
    if(!wSelect) return;
    wSelect.innerHTML = '<option value="local">📍 Local Area</option>';
    const lowerFilter = filterText.toLowerCase();
    let seen = new Set();
    allTimezones.forEach(opt => {
        if(!seen.has(opt.city)) {
            seen.add(opt.city);
            if(opt.city.toLowerCase().includes(lowerFilter) || opt.region.toLowerCase().includes(lowerFilter)) {
                wSelect.add(new Option(`${opt.city} (${opt.region})`, opt.city));
            }
        }
    });
}
function filterWeatherCities() {
    const val = document.getElementById('weather-search').value;
    renderWeatherCities(val);
    const wSelect = document.getElementById('weather-city-select');
    if (val.trim() !== '' && wSelect.options.length > 1) { wSelect.selectedIndex = 1; getWeather(); }
}

function setClockType(type) {
    if(type === 'digital') {
        document.getElementById('digital-clock-container').style.display = 'block';
        document.getElementById('analog-clock-container').style.display = 'none';
        document.getElementById('btn-digital').classList.add('active-toggle');
        document.getElementById('btn-analog').classList.remove('active-toggle');
    } else {
        document.getElementById('digital-clock-container').style.display = 'none';
        document.getElementById('analog-clock-container').style.display = 'flex';
        document.getElementById('btn-digital').classList.remove('active-toggle');
        document.getElementById('btn-analog').classList.add('active-toggle');
    }
}

function updateAlarmLabels() {
    const h = parseInt(document.getElementById('alarm-h').value);
    const advice = document.getElementById('alarm-advice');
    if (!advice) return;
    if (h >= 5 && h < 12) advice.innerText = "💡 Morning light resets your focus.";
    else if (h >= 12 && h < 17) advice.innerText = "💡 A 20 min nap is peak efficiency.";
    else if (h >= 17 && h < 22) advice.innerText = "💡 Dim lights now for better sleep.";
    else advice.innerText = "💡 Blue light blocks sleep hormones.";
}

function startRinging(type) {
    isRinging = true;
    
    if ("Notification" in window && Notification.permission === "granted") {
        const notifyTitle = type === 'alarm' ? "⏰ Alarm" : (type === 'tomato' ? "🍅 Pomodoro" : "📝 Reminder");
        new Notification(`Zenith: ${notifyTitle}`, { body: "It's time!" });
    }

    const ringtoneId = type === 'tomato' ? 'tomato-ringtone' : 'alarm-ringtone';
    alarmSound.src = document.getElementById(ringtoneId) ? document.getElementById(ringtoneId).value : 'music/flutie8211-triple-high-pitch-electronic-beeps-486292.mp3';
    alarmSound.loop = true; 
    alarmSound.play().catch(e => console.log('Audio blocked.'));

    if (type === 'alarm') {
        document.getElementById('set-alarm-btn').style.display = 'none';
        document.getElementById('cancel-alarm-btn').style.display = 'none';
        document.getElementById('stop-alarm-btn').style.display = 'block';
    } else if (type === 'tomato') {
        document.getElementById('tomato-btn').style.display = 'none';
        document.getElementById('tomato-reset-btn').style.display = 'none';
        document.getElementById('stop-tomato-btn').style.display = 'block';
    } else if (type === 'reminder') {
        document.getElementById('add-reminder-btn').style.display = 'none';
        document.getElementById('stop-reminder-btn').style.display = 'block';
    }
}

function stopRinging(type) {
    alarmSound.pause(); alarmSound.currentTime = 0; isRinging = false; 
    
    if (type === 'alarm') {
        document.getElementById('set-alarm-btn').style.display = 'block'; 
        document.getElementById('cancel-alarm-btn').style.display = 'none';
        document.getElementById('stop-alarm-btn').style.display = 'none'; 
        document.getElementById('alarm-status').innerText = ""; targetAlarm = null;
    } else if (type === 'tomato') {
        document.getElementById('tomato-btn').style.display = 'block';
        document.getElementById('tomato-reset-btn').style.display = 'block';
        document.getElementById('stop-tomato-btn').style.display = 'none'; 
        resetTomato();
    } else if (type === 'reminder') {
        document.getElementById('add-reminder-btn').style.display = 'block';
        document.getElementById('stop-reminder-btn').style.display = 'none';
    }
}

function toggleAdvancedTomato() {
    isAdvancedTomato = !isAdvancedTomato;
    const advSec = document.getElementById('advanced-tomato-section');
    const norSec = document.getElementById('normal-tomato-section');
    
    if (isAdvancedTomato) {
        advSec.style.display = 'flex';
        norSec.style.display = 'none';
        renderTomatoTimeline();
        updateTomatoPreview();
    } else {
        advSec.style.display = 'none';
        norSec.style.display = 'block';
        advancedCurrentIndex = -1;
        updateTomatoPreview();
    }
}

function renderTomatoTimeline() {
    const list = document.getElementById('tomato-timeline-list');
    list.innerHTML = '';
    tomatoTimeline.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'timeline-item';
        div.draggable = true;
        
        if (isAdvancedTomato && isRunning && index === advancedCurrentIndex) {
            div.style.borderLeftColor = '#facc15';
            div.style.background = 'rgba(250, 204, 21, 0.15)';
        }

        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="drag-handle">≡</span>
                <span style="color:#fff; font-weight:bold; font-size:0.9rem;">${item.name}</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="color:var(--dynamic-accent); font-size:0.85rem; font-weight:bold;">${item.mins} m</span>
                <button class="delete-btn" style="font-size:0.9rem;" onclick="deleteTimelineItem(${item.id})">✕</button>
            </div>
        `;

        div.addEventListener('dragstart', (e) => { draggedItemIndex = index; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => div.style.opacity = '0.5', 0); });
        div.addEventListener('dragend', () => { draggedItemIndex = null; div.style.opacity = '1'; renderTomatoTimeline(); });
        div.addEventListener('dragover', (e) => { e.preventDefault(); div.classList.add('drag-over'); });
        div.addEventListener('dragleave', () => { div.classList.remove('drag-over'); });
        div.addEventListener('drop', (e) => {
            e.preventDefault(); div.classList.remove('drag-over');
            if (draggedItemIndex !== null && draggedItemIndex !== index) {
                const draggedItem = tomatoTimeline.splice(draggedItemIndex, 1)[0];
                tomatoTimeline.splice(index, 0, draggedItem);
                localStorage.setItem('zenith_tomato_timeline', JSON.stringify(tomatoTimeline));
                renderTomatoTimeline();
                if(!isRunning) updateTomatoPreview();
            }
        });
        list.appendChild(div);
    });
}

function addTimelineItem() {
    const name = document.getElementById('timeline-name').value;
    const mins = parseInt(document.getElementById('timeline-mins').value);
    if(!name || isNaN(mins) || mins <= 0) { alert('請輸入有效的階段名稱與分鐘數！'); return; }
    tomatoTimeline.push({ id: Date.now(), name, mins });
    localStorage.setItem('zenith_tomato_timeline', JSON.stringify(tomatoTimeline));
    renderTomatoTimeline();
    if(!isRunning) updateTomatoPreview();
    document.getElementById('timeline-name').value = ''; document.getElementById('timeline-mins').value = '';
}

function deleteTimelineItem(id) {
    tomatoTimeline = tomatoTimeline.filter(t => t.id !== id);
    localStorage.setItem('zenith_tomato_timeline', JSON.stringify(tomatoTimeline));
    renderTomatoTimeline();
    if(!isRunning) updateTomatoPreview();
}

function updateTomatoPreview() {
    if (isAdvancedTomato) {
        if (tomatoTimeline.length > 0) {
            const index = advancedCurrentIndex === -1 ? 0 : advancedCurrentIndex;
            const mins = tomatoTimeline[index] ? tomatoTimeline[index].mins : 0;
            const h = Math.floor(mins / 60), m = mins % 60;
            document.getElementById('tomato-display').innerText = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:00`;
        } else {
            document.getElementById('tomato-display').innerText = `00:00:00`;
        }
    } else {
        const h = document.getElementById('tomato-h').value.padStart(2,'0'), m = document.getElementById('tomato-m').value.padStart(2,'0'), s = document.getElementById('tomato-s').value.padStart(2,'0');
        document.getElementById('tomato-display').innerText = `${h}:${m}:${s}`;
    }
}

function toggleTomato() {
    const btn = document.getElementById('tomato-btn');
    if (isRunning) { 
        clearInterval(tmInterval); isRunning = false; btn.innerText = "Resume Session"; 
    } else {
        if (timeLeft <= 0) {
            if (isAdvancedTomato) {
                if (tomatoTimeline.length === 0) { alert('Your timeline is empty!'); return; }
                if (advancedCurrentIndex === -1) advancedCurrentIndex = 0;
                if (advancedCurrentIndex >= tomatoTimeline.length) advancedCurrentIndex = 0; 
                timeLeft = tomatoTimeline[advancedCurrentIndex].mins * 60;
                renderTomatoTimeline();
            } else {
                timeLeft = (parseInt(document.getElementById('tomato-h').value) * 3600) + 
                           (parseInt(document.getElementById('tomato-m').value) * 60) + 
                           parseInt(document.getElementById('tomato-s').value);
            }
        }
        
        if (timeLeft > 0) {
            isRunning = true; 
            btn.innerText = "Pause";
            tmInterval = setInterval(() => { 
                timeLeft--; updateTomatoDisplay(); 
                if (timeLeft <= 0) { 
                    clearInterval(tmInterval); 
                    isRunning = false; 
                    startRinging('tomato'); 
                    
                    if (isAdvancedTomato) {
                        advancedCurrentIndex++;
                        if (advancedCurrentIndex < tomatoTimeline.length) {
                            setTimeout(() => {
                                stopRinging('tomato'); 
                                timeLeft = tomatoTimeline[advancedCurrentIndex].mins * 60;
                                renderTomatoTimeline(); 
                                toggleTomato(); 
                            }, 3000);
                        } else {
                            advancedCurrentIndex = -1; 
                            btn.innerText = "Start Session";
                            renderTomatoTimeline();
                        }
                    } else {
                        btn.innerText = "Start Session"; 
                    }
                } 
            }, 1000);
        }
    }
}

function resetTomato() { 
    clearInterval(tmInterval); isRunning = false; timeLeft = 0; 
    advancedCurrentIndex = -1;
    updateTomatoPreview(); 
    if(isAdvancedTomato) renderTomatoTimeline();
    document.getElementById('tomato-btn').innerText = "Start Session";
}

async function getWeather(targetCity) {
    let city = targetCity;
    if (!city) {
        const selectEl = document.getElementById('weather-city-select');
        city = selectEl ? selectEl.value : 'local';
    }
    const selectEl = document.getElementById('weather-city-select');
    if (selectEl && city === 'local') { selectEl.value = 'local'; }

    const url = city === 'local' ? `https://wttr.in/?format=j1` : `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const temp = parseInt(data.current_condition[0].temp_C);
        const cond = data.current_condition[0].weatherDesc[0].value.toLowerCase();
        
        document.getElementById('temp').innerText = temp + "°";
        let displayCond = cond.length > 12 ? cond.split(' ').slice(0,2).join(' ') : cond;
        if (city !== 'local' && data.nearest_area && data.nearest_area[0]) {
            const areaName = data.nearest_area[0].areaName[0].value;
            displayCond = `${areaName} • ${displayCond}`;
        } else if (city === 'local') {
            displayCond = `Local • ${displayCond}`;
        }
        document.getElementById('condition').innerText = displayCond;
        applyStyles(temp, cond);
    } catch (e) { 
        applyStyles(20, 'clear'); document.getElementById('condition').innerText = "Not Found"; 
    }
}

function applyStyles(temp, cond) {
    const stage = document.querySelector('.sky-stage'), sun = document.querySelector('.sun');
    stage.className = 'sky-stage'; sun.className = 'sun'; document.body.className = '';
    const isRain = cond.includes('rain') || cond.includes('shower');
    const isCloudy = cond.includes('cloud') || cond.includes('overcast');
    if (temp > 28) { stage.classList.add('weather-hot'); document.body.classList.add('theme-hot'); }
    else if (isRain) { stage.classList.add('weather-rain'); document.body.classList.add('theme-rain'); }
    else if (isCloudy) { stage.classList.add('weather-wind'); document.body.classList.add('theme-wind'); }
    else { stage.classList.add('weather-cool'); document.body.classList.add('theme-cool'); }
}

function setAlarm() {
    targetAlarm = `${document.getElementById('alarm-h').value.padStart(2,'0')}:${document.getElementById('alarm-m').value.padStart(2,'0')}:${document.getElementById('alarm-s').value.padStart(2,'0')}`;
    document.getElementById('alarm-status').innerText = "Alarm set: " + targetAlarm;
    
    document.getElementById('set-alarm-btn').style.display = 'none';
    document.getElementById('cancel-alarm-btn').style.display = 'block';
}

function cancelAlarm() {
    targetAlarm = null;
    document.getElementById('alarm-status').innerText = "Alarm cancelled.";
    document.getElementById('set-alarm-btn').style.display = 'block';
    document.getElementById('cancel-alarm-btn').style.display = 'none';
    setTimeout(() => { if (document.getElementById('alarm-status').innerText === "Alarm cancelled.") document.getElementById('alarm-status').innerText = ""; }, 3000);
}

function updateTomatoDisplay() {
    const h = Math.floor(timeLeft / 3600), m = Math.floor((timeLeft % 3600) / 60), s = timeLeft % 60;
    document.getElementById('tomato-display').innerText = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function renderColorPalette() {
    const container = document.getElementById('color-palette-container');
    if(!container) return;
    container.innerHTML = '';
    
    colorTags.forEach((tag, index) => {
        const div = document.createElement('div');
        div.className = `color-row ${selectedColor === tag.color ? 'active-tag' : ''}`;
        div.onclick = () => { selectedColor = tag.color; renderColorPalette(); };
        
        const dot = document.createElement('div');
        dot.className = 'color-dot'; dot.style.backgroundColor = tag.color;
        
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'color-tag-input'; input.value = tag.label;
        input.onchange = (e) => { tag.label = e.target.value; localStorage.setItem('zenith_color_tags', JSON.stringify(colorTags)); saveAndRenderReminders(); };
        input.onclick = (e) => e.stopPropagation(); 
        
        div.appendChild(dot); div.appendChild(input);

        if(index >= 4) {
            const delBtn = document.createElement('span');
            delBtn.innerText = '✕'; delBtn.style.color = 'rgba(255,255,255,0.4)'; delBtn.style.cursor = 'pointer'; delBtn.style.marginLeft = 'auto'; delBtn.style.fontSize = '0.8rem';
            delBtn.onclick = (e) => {
                e.stopPropagation(); colorTags.splice(index, 1);
                if(selectedColor === tag.color) selectedColor = colorTags[0].color;
                localStorage.setItem('zenith_color_tags', JSON.stringify(colorTags)); renderColorPalette();
            };
            div.appendChild(delBtn);
        }
        container.appendChild(div);
    });

    const addDiv = document.createElement('div');
    addDiv.className = 'color-row add-custom-color';
    addDiv.innerHTML = `<span style="color: var(--text-dim); font-size: 0.85rem; font-weight: bold;">+ Custom Color</span>`;
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color'; colorPicker.className = 'color-picker-input';
    colorPicker.onchange = (e) => {
        const newColor = e.target.value; colorTags.push({ color: newColor, label: 'New Tag' });
        selectedColor = newColor; localStorage.setItem('zenith_color_tags', JSON.stringify(colorTags)); renderColorPalette();
    };
    addDiv.appendChild(colorPicker); container.appendChild(addDiv);
}

function jumpToDate() {
    const monthSelect = document.getElementById('cal-month-select');
    const yearSelect = document.getElementById('cal-year-select');
    if(monthSelect && yearSelect) {
        calDate.setMonth(parseInt(monthSelect.value)); calDate.setFullYear(parseInt(yearSelect.value)); renderCalendar();
    }
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthSelect = document.getElementById('cal-month-select');
    const yearSelect = document.getElementById('cal-year-select');
    if(!grid || !monthSelect || !yearSelect) return; 
    
    grid.innerHTML = '';
    const year = calDate.getFullYear(), month = calDate.getMonth();
    
    if (monthSelect.options.length === 0) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        months.forEach((m, i) => monthSelect.add(new Option(m, i)));
    }
    if (yearSelect.options.length === 0) {
        const curY = new Date().getFullYear();
        for(let i = curY - 5; i <= curY + 10; i++) yearSelect.add(new Option(i, i));
    }
    
    monthSelect.value = month;
    let yearExists = false;
    for(let i = 0; i < yearSelect.options.length; i++) { if(parseInt(yearSelect.options[i].value) === year) { yearExists = true; break; } }
    if(!yearExists) yearSelect.add(new Option(year, year));
    yearSelect.value = year;
    
    const weeks = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    weeks.forEach(w => {
        const el = document.createElement('div');
        el.className = 'cal-cell cal-label'; el.innerText = w; grid.appendChild(el);
    });
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    for(let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div'); emptyCell.className = 'cal-cell empty'; grid.appendChild(emptyCell);
    }
    
    for(let day = 1; day <= totalDays; day++) {
        const cell = document.createElement('div'); cell.className = 'cal-cell'; cell.innerText = day;
        const thisDateStr = `${year}-${(month+1).toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}`;
        if(thisDateStr === selectedDateStr) cell.classList.add('selected');
        cell.onclick = () => { selectedDateStr = thisDateStr; renderCalendar(); };
        grid.appendChild(cell);
    }
}

function changeMonth(direction) { calDate.setMonth(calDate.getMonth() + direction); renderCalendar(); }

function addReminder() {
    const input = document.getElementById('remind-input'), hStr = document.getElementById('remind-h').value, mStr = document.getElementById('remind-m').value, ampm = document.getElementById('remind-ampm').value;
    if (!input || input.value.trim() === "") { alert("Please enter what to remember."); return; }

    let h24 = parseInt(hStr, 10);
    if (ampm === "PM" && h24 !== 12) h24 += 12;
    if (ampm === "AM" && h24 === 12) h24 = 0;
    
    const time24 = `${h24.toString().padStart(2,'0')}:${mStr}:00`, displayTime = `${hStr}:${mStr} ${ampm}`;
    const newReminder = { 
        id: Date.now(), text: input.value, date: selectedDateStr, time: time24, displayTime: displayTime, color: selectedColor, notified: false, done: false
    };
    reminders.push(newReminder); saveAndRenderReminders(); input.value = "";
}

function deleteReminder(id) { reminders = reminders.filter(r => r.id !== id); saveAndRenderReminders(); }

function toggleReminderDone(id) {
    reminders = reminders.map(r => { if(r.id === id) r.done = !r.done; return r; });
    saveAndRenderReminders();
}

function saveAndRenderReminders() {
    localStorage.setItem('zenith_reminders', JSON.stringify(reminders));
    const list = document.getElementById('reminder-list');
    if(!list) return;
    list.innerHTML = "";
    
    const searchInput = document.getElementById('reminder-search');
    const filterText = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    reminders.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).forEach(r => {
        const tagObj = colorTags.find(t => t.color === r.color);
        const tagLabel = tagObj ? tagObj.label : 'Task';
        
        if (filterText) {
            const textMatch = r.text.toLowerCase().includes(filterText);
            const tagMatch = tagLabel.toLowerCase().includes(filterText);
            const dateMatch = r.date.includes(filterText);
            if (!textMatch && !tagMatch && !dateMatch) return; 
        }

        const timeText = r.displayTime || r.time; 
        const isDoneClass = r.done ? 'task-done' : '';

        const div = document.createElement('div');
        div.className = `reminder-card ${isDoneClass}`; 
        div.style.borderLeftColor = r.color; 
        div.innerHTML = `
            <div style="display:flex; flex-direction:column; gap: 4px; text-align: left; flex:1;">
                <div style="display:flex; align-items:center; gap: 8px;">
                    <input type="checkbox" style="cursor:pointer; accent-color: var(--dynamic-accent); width: 16px; height: 16px;" ${r.done ? 'checked' : ''} onclick="toggleReminderDone(${r.id})">
                    <span style="font-weight: 800; color: ${r.color}; font-size: 0.9rem;">[${tagLabel}]</span>
                    <span style="font-size: 0.85rem; color: var(--text-dim);">${r.date} ${timeText}</span>
                </div>
                <span class="task-text" style="color: #f4f4f5; font-size: 1rem; margin-top:2px;">${r.text}</span>
            </div>
            <button class="delete-btn" onclick="deleteReminder(${r.id})">✕</button>
        `;
        list.appendChild(div);
    });
}

setInterval(() => {
    const now = new Date();
    const curTime = now.toLocaleTimeString('en-GB', { hour12: false }); 
    const curDate = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
    
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeek = weekDays[now.getDay()];
    const mainDateEl = document.getElementById('main-date');
    if (mainDateEl) mainDateEl.innerText = `${curDate} (${dayOfWeek})`;

    document.getElementById('main-clock').innerText = curTime;
    if (targetAlarm === curTime && !isRinging) startRinging('alarm'); 
    
    reminders.forEach(r => {
        if (r.date === curDate && r.time === curTime && !r.notified && !r.done) {
            if(!isRinging) startRinging('reminder');
            r.notified = true;
            localStorage.setItem('zenith_reminders', JSON.stringify(reminders));
        }
    });

    const tzSelect = document.getElementById('tz-select');
    if(tzSelect) {
        const tz = tzSelect.value;
        let opt = { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' };
        if(tz !== 'local') opt.timeZone = tz;
        
        const tzTimeStr = new Date().toLocaleTimeString('en-GB', opt);
        document.getElementById('world-time').innerText = tzTimeStr;
        
        const parts = tzTimeStr.split(':');
        if(parts.length === 3) {
            const h = parseInt(parts[0]), m = parseInt(parts[1]), s = parseInt(parts[2]);
            const hDeg = (h % 12) * 30 + (m * 0.5);
            const mDeg = (m * 6) + (s * 0.1);      
            const sDeg = s * 6;                     
            
            document.getElementById('analog-hour').style.transform = `rotate(${hDeg}deg)`;
            document.getElementById('analog-min').style.transform = `rotate(${mDeg}deg)`;
            document.getElementById('analog-sec').style.transform = `rotate(${sDeg}deg)`;
        }
    }
}, 1000);

function switchTab(id, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if(el) el.classList.add('active');
}

window.onload = () => {
    initSelectors();
    getWeather();
    renderCalendar();       
    renderColorPalette();   
    saveAndRenderReminders();
};