const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/img', express.static(path.join(__dirname, 'img')));

// --- CONFIGURATION ---
const RESTAURANT_NAME = "Sonata";
const BACKGROUND_URL = "/img/bg.jpg"; 

// --- DATA & STATE ---
const TABLES = Array.from({ length: 20 }, (_, i) => i + 1);
let activeOrders = {}; 
let tableTabs = {}; 
TABLES.forEach(t => tableTabs[t] = { items: [], total: 0 });

const MENU = {
    appetizers: [
        { id: 1, name: "Garlic Bread", price: 5.99, stock: 50, active: true, img: "/img/1.jpg" },
        { id: 2, name: "Bruschetta", price: 7.50, stock: 50, active: true, img: "/img/2.jpg" },
        { id: 3, name: "Stuffed Mushrooms", price: 8.99, stock: 50, active: true, img: "/img/3.jpg" },
        { id: 4, name: "Calamari Rings", price: 12.00, stock: 50, active: true, img: "/img/4.jpg" },
        { id: 5, name: "Chicken Wings", price: 10.50, stock: 50, active: true, img: "/img/5.jpg" }
    ],
    salads: [
        { id: 21, name: "Garden Salad", price: 7.99, stock: 50, active: true, img: "/img/21.jpg" },
        { id: 22, name: "Caesar Salad", price: 9.50, stock: 50, active: true, img: "/img/22.jpg" }
    ],
    mains: [
        { id: 61, name: "Grilled Ribeye", price: 28.99, stock: 50, active: true, img: "/img/61.jpg" },
        { id: 62, name: "Chicken Alfredo", price: 18.50, stock: 50, active: true, img: "/img/62.jpg" }
    ],
    desserts: [
        { id: 81, name: "Cheesecake", price: 7.99, stock: 50, active: true, img: "/img/81.jpg" },
        { id: 82, name: "Chocolate Cake", price: 6.50, stock: 50, active: true, img: "/img/82.jpg" }
    ],
    bar: [
        { id: 101, name: "Lager Beer", price: 6.00, stock: 50, active: true, img: "/img/101.jpg" },
        { id: 102, name: "IPA", price: 7.50, stock: 50, active: true, img: "/img/102.jpg" }
    ]
};

// --- LOGIC ---
function processOrder(tableNum, items, prefix = 'ORD-') {
    const orderId = prefix + Date.now();
    items.forEach(orderedItem => {
        const item = MENU[orderedItem.category].find(i => i.id === orderedItem.id);
        if (item) item.stock = Math.max(0, item.stock - orderedItem.qty);
    });
    io.emit('menu-updated', MENU);
    const kitchenItems = items.filter(i => i.category !== 'bar');
    const barItems = items.filter(i => i.category === 'bar');
    activeOrders[orderId] = { id: orderId, table: tableNum, items: items, status: { kitchen: kitchenItems.length === 0, bar: barItems.length === 0 } };
    if (kitchenItems.length > 0) io.emit('kitchen-order', { id: orderId, table: tableNum, items: kitchenItems });
    if (barItems.length > 0) io.emit('bar-order', { id: orderId, table: tableNum, items: barItems });
    items.forEach(item => { tableTabs[tableNum].items.push(item); tableTabs[tableNum].total += (item.price * item.qty); });
    io.emit('tabs-update', tableTabs);
}

io.on('connection', (socket) => {
    socket.emit('init-menu', MENU);
    socket.emit('tabs-update', tableTabs);
    socket.on('bulk-update', (updates) => {
        updates.forEach(upd => {
            const item = MENU[upd.category].find(i => i.id === upd.id);
            if (item) { 
                item.name = upd.name; 
                item.price = parseFloat(upd.price); 
                item.stock = parseInt(upd.stock); 
                item.active = upd.active; 
                item.img = upd.img; 
            }
        });
        io.emit('menu-updated', MENU);
    });
    socket.on('new-order', (order) => processOrder(order.table, order.items));
    socket.on('complete-part', ({ id, station }) => {
        if (activeOrders[id]) {
            activeOrders[id].status[station] = true;
            if (activeOrders[id].status.kitchen && activeOrders[id].status.bar) {
                io.emit('order-status-update', { table: activeOrders[id].table, message: `Table #${activeOrders[id].table} READY!` });
                delete activeOrders[id];
            }
        }
    });
    socket.on('process-payment', ({ table, method }) => {
        const amount = tableTabs[table].total;
        tableTabs[table] = { items: [], total: 0 };
        io.emit('tabs-update', tableTabs);
        io.emit('order-status-update', { table, message: `Table ${table} Paid ($${amount.toFixed(2)} - ${method.toUpperCase()})` });
    });
});

// --- UI GENERATORS ---

function generateAdmin() {
    return `<html><head><title>Admin - ${RESTAURANT_NAME}</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { font-family: sans-serif; padding: 30px; background: #f0f2f5; }
        .item-row { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #ddd; background: white; margin-bottom: 5px; align-items: center; border-radius: 4px; }
        .save-btn { position: fixed; bottom: 20px; right: 20px; padding: 15px 40px; background: #27ae60; color: white; border: none; border-radius: 30px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
        input { padding: 5px; margin: 0 5px; border: 1px solid #ccc; border-radius: 4px; }
        h2 { color: #2c3e50; border-bottom: 2px solid #2c3e50; padding-bottom: 5px; margin-top: 30px;}
    </style></head>
    <body>
        <h1>Menu Admin - ${RESTAURANT_NAME}</h1>
        <div id="content"></div>
        <button class="save-btn" onclick="save()">SAVE ALL CHANGES</button>
    <script>
        const socket = io();
        socket.on('init-menu', render);
        socket.on('menu-updated', render);
        function render(menu) {
            let h = '';
            for (let c in menu) {
                h += '<h2>' + c.toUpperCase() + '</h2>';
                menu[c].forEach(i => {
                    h += \`<div class="item-row" data-cat="\${c}" data-id="\${i.id}">
                        <label><input type="checkbox" class="act" \${i.active ? 'checked' : ''}> Active</label>
                        <input type="text" class="name-in" value="\${i.name}" style="flex:2">
                        $<input type="number" step="0.01" class="price" value="\${i.price.toFixed(2)}" style="width:80px">
                        Stock: <input type="number" class="stock" value="\${i.stock}" style="width:60px">
                        Img: <input type="text" class="img-path" value="\${i.img}" style="flex:1">
                    </div>\`;
                });
            }
            document.getElementById('content').innerHTML = h;
        }
        function save() {
            const updates = [];
            document.querySelectorAll('.item-row').forEach(r => {
                updates.push({
                    category: r.dataset.cat, id: parseInt(r.dataset.id), active: r.querySelector('.act').checked,
                    name: r.querySelector('.name-in').value, price: r.querySelector('.price').value,
                    stock: r.querySelector('.stock').value, img: r.querySelector('.img-path').value
                });
            });
            socket.emit('bulk-update', updates); alert('Saved!');
        }
    </script></body></html>`;
}

function generatePOS() {
    return `<html><head><title>POS - ${RESTAURANT_NAME}</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body{ font-family:sans-serif; margin:0; display:flex; flex-direction:column; height:100vh; background: url('${BACKGROUND_URL}') no-repeat center center fixed; background-size: cover; }
        .header-brand{ background:rgba(44, 62, 80, 0.95); color:white; padding:15px; text-align:center; font-size:1.4em; font-weight:bold; letter-spacing:2px; border-bottom:2px solid #f1c40f;}
        .nav{background:rgba(44, 62, 80, 0.85); padding:10px; display:flex; gap:10px;}
        .nav button{background:none; border:1px solid white; color:white; padding:10px; cursor:pointer; border-radius:4px;}
        .nav button.active{background:white; color:#2c3e50;}
        .main{display:flex; flex:1; overflow:hidden;}
        .left{flex:2; padding:20px; overflow-y:auto; background:rgba(255,255,255,0.45);}
        .side{flex:1; border-left:1px solid rgba(0,0,0,0.1); padding:20px; background:rgba(255,255,255,0.7); display:flex; flex-direction:column; max-width:350px;}
        .grid{display:grid; grid-template-columns:repeat(5, 1fr); gap:10px; width:100%;}
        .item{padding:10px; background:#fff; border:1px solid #ddd; text-align:center; cursor:pointer; border-radius:5px;}
        .item img{width:100%; height:80px; object-fit:cover; border-radius:3px; margin-bottom:5px;}
        .t-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:10px;}
        .t-card{padding:15px; border:2px solid #27ae60; text-align:center; cursor:pointer; background:rgba(232, 245, 233, 0.9); font-weight:bold; border-radius:8px;}
        .t-card.occupied{border-color:#e74c3c; background:rgba(250, 219, 216, 0.9);}
        .cat-bar{display:flex; gap:5px; margin-bottom:15px; overflow-x:auto;}
        .cat-btn{padding:10px; background:#fff; border:1px solid #ddd; cursor:pointer; border-radius:5px;}
        .cat-btn.active{background:#2c3e50; color:white;}
    </style></head>
    <body>
    <div class="header-brand">${RESTAURANT_NAME}</div>
    <div class="nav"><button id="btnOrder" class="active" onclick="setView('order')">ORDERS</button><button id="btnPay" onclick="setView('pay')">TABLES</button></div>
    <div class="main">
        <div class="left"><div id="orderView"><div id="notifications"></div><div id="menu"></div></div><div id="payView" class="t-grid" style="display:none">${TABLES.map(t=>`<div id="tInner-${t}" class="t-card" onclick="selectTab(${t})">T${t}</div>`).join('')}</div></div>
        <div class="side">
            <div id="sideOrder" style="display:flex;flex-direction:column;height:100%;">
                <h3>Table: <select id="tableSel">${TABLES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></h3>
                <div id="cart" style="flex:1;overflow-y:auto;"></div><hr>
                <h2>Total: $<span id="cartTotal">0.00</span></h2>
                <button onclick="sendOrder()" style="width:100%;padding:15px;background:#2c3e50;color:white;font-weight:bold;border:none;cursor:pointer;border-radius:5px;">SEND ORDER</button>
            </div>
            <div id="sidePay" style="display:none;flex-direction:column;height:100%;">
                <h3 id="payTitle">Select a Table</h3><div id="billItems" style="flex:1;overflow-y:auto;"></div><hr>
                <h2 id="billTotal">Total: $0.00</h2>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <button onclick="processPay('cash')" style="padding:15px;background:#27ae60;color:white;font-weight:bold;border:none;border-radius:5px;cursor:pointer">CASH</button>
                    <button onclick="processPay('card')" style="padding:15px;background:#2980b9;color:white;font-weight:bold;border:none;border-radius:5px;cursor:pointer">CARD</button>
                </div>
            </div>
        </div>
    </div>
    <script>
        const socket=io(); let menu={}, cart=[], tabs={}, currentCat='appetizers', selectedTab=null;
        socket.on('init-menu', m => { menu=m; renderMenu(); });
        socket.on('menu-updated', m => { menu=m; renderMenu(); });
        socket.on('tabs-update', t => { 
            tabs=t; for(let i in t){ const el=document.getElementById('tInner-'+i); if(el) el.className = t[i].total > 0 ? 't-card occupied' : 't-card'; }
            if(selectedTab) selectTab(selectedTab);
        });
        function renderMenu(){
            let h = '<div class="cat-bar">' + Object.keys(menu).map(c => \`<button class="cat-btn \${c===currentCat?'active':''}" onclick="setCat('\${c}')">\${c.toUpperCase()}</button>\`).join('') + '</div>';
            h += '<div class="grid">';
            (menu[currentCat]||[]).filter(i => i.active).forEach(i => {
                h += \`<div class="item" onclick="addToCart('\${currentCat}', \${i.id})">
                    <img src="\${i.img}" onerror="this.src='https://via.placeholder.com/80'">
                    <b>\${i.name}</b><br>$\${i.price.toFixed(2)}</div>\`;
            });
            document.getElementById('menu').innerHTML = h;
        }
        function setCat(c){ currentCat=c; renderMenu(); }
        function setView(v){
            document.getElementById('orderView').style.display = v==='order'?'block':'none';
            document.getElementById('payView').style.display = v==='pay'?'grid':'none';
            document.getElementById('sideOrder').style.display = v==='order'?'flex':'none';
            document.getElementById('sidePay').style.display = v==='pay'?'flex':'none';
            document.getElementById('btnOrder').className = v==='order'?'active':'';
            document.getElementById('btnPay').className = v==='pay'?'active':'';
        }
        function addToCart(cat, id){
            const item = menu[cat].find(x => x.id === id);
            const inCart = cart.find(x => x.id === id && x.category === cat);
            if(inCart) inCart.qty++; else cart.push({...item, category:cat, qty:1});
            renderCart();
        }
        function renderCart(){
            document.getElementById('cart').innerHTML = cart.map(i=>\`<div>\${i.name} x\${i.qty}</div>\`).join('');
            document.getElementById('cartTotal').innerText = cart.reduce((s,i)=>s+(i.price*i.qty),0).toFixed(2);
        }
        function sendOrder(){ if(!cart.length) return; socket.emit('new-order', { table: document.getElementById('tableSel').value, items: cart }); cart=[]; renderCart(); }
        function selectTab(t){
            selectedTab = t; document.getElementById('payTitle').innerText = 'Table #' + t;
            document.getElementById('billTotal').innerText = 'Total: $' + tabs[t].total.toFixed(2);
            document.getElementById('billItems').innerHTML = tabs[t].items.map(i=>\`<div>\${i.qty}x \${i.name}</div>\`).join('');
        }
        function processPay(method){ if(!selectedTab || tabs[selectedTab].total === 0) return; socket.emit('process-payment', { table: selectedTab, method }); alert('Paid!'); }
        socket.on('order-status-update', o => {
            const d = document.createElement('div'); d.style.background="rgba(255,255,255,0.9)"; d.style.padding="10px"; d.style.border="1px solid #f1c40f"; d.innerHTML = \`\${o.message} <button onclick="this.parentElement.remove()">X</button>\`;
            document.getElementById('notifications').prepend(d);
        });
    </script></body></html>`;
}

function generateMonitor(name, station) {
    return `<html><head><title>${name} Monitor</title><script src="/socket.io/socket.io.js"></script>
    <style>
        body{ font-family:sans-serif; background: url('${BACKGROUND_URL}') no-repeat center center fixed; background-size: cover; color:white; padding:20px; }
        .header-m{ background:rgba(0,0,0,0.85); padding:15px; border-radius:8px; margin-bottom:20px; text-align:center; border-bottom: 2px solid #e74c3c; }
        .ticket{background:rgba(255,255,255,0.9); color:#333; padding:15px; border-radius:8px; margin-bottom:10px;}
        .btn{background:#27ae60; color:white; border:none; padding:10px; width:100%; cursor:pointer; border-radius:5px;}
    </style></head>
    <body>
    <div class="header-m"><h1>${RESTAURANT_NAME} - ${name}</h1></div>
    <div id="tix" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:20px;"></div>
    <script>
        const socket=io(); 
        socket.on('${station}-order', o => {
            const d=document.createElement('div'); d.className='ticket'; d.id='o-'+o.id;
            d.innerHTML=\`<h3>Table #\${o.table}</h3>\${o.items.map(i=>'<div>'+i.qty+'x '+i.name+'</div>').join('')}<button class="btn" onclick="done('\${o.id}')">READY</button>\`;
            document.getElementById('tix').appendChild(d);
        });
        function done(id){ socket.emit('complete-part',{id,station:'${station}'}); document.getElementById('o-'+id).remove(); }
    </script></body></html>`;
}

app.get('/kitchen', (req, res) => res.send(generateMonitor('Kitchen', 'kitchen')));
app.get('/bar', (req, res) => res.send(generateMonitor('Bar', 'bar')));
app.get('/admin', (req, res) => res.send(generateAdmin()));
app.get('/', (req, res) => res.send(generatePOS()));

server.listen(3000, () => console.log('Full System Ready at Port 3000'));
