const mssqlPath = 'C:\\Users\\saada\\AppData\\Local\\npm-cache\\_npx\\ffdd41263fd07c20\\node_modules\\mssql';
const sql = require(mssqlPath);
const fs = require('fs');

const CONFIG = {
  server: '203.202.241.211', port: 1433,
  user: 'mcp_user', password: 'iAOS@35o997',
  database: 'DWH',
  options: { encrypt: false, trustServerCertificate: false, connectTimeout: 15000, requestTimeout: 300000 }
};

const SBU_IDS = [4, 224, 144, 8, 175, 220, 188, 189, 232, 237];
const OUT = 'C:\\Users\\saada\\OneDrive\\Documents\\Default Project';

async function run() {
  console.log('Connecting...');
  const pool = await sql.connect(CONFIG);

  // DYNAMIC: always compare current year vs previous year, all months present in both.
  // New months (e.g. September) appear automatically once postings exist in both years.
  const yrThis = new Date().getFullYear();
  const yrLast = yrThis - 1;
  console.log(`Fetching YoY data for ${yrLast} vs ${yrThis}, all months... FIXED: Item Type via tblItemArc`);
  const res = await pool.request().query(`
    SELECT 
      b.strBusinessUnitCode AS sbu,
      b.strBusinessUnitName AS sbu_name,
      r.intItemId AS sys_id,
      COALESCE(i.strItemCode, CAST(r.intItemId AS NVARCHAR(50))) AS item_code,
      r.strItemName AS item_desc,
      COALESCE(i.strItemTypeName, m.strItemMasterTypeName,
        CASE WHEN r.strItemName LIKE '%Bag%' OR r.strItemName LIKE '%Pack%' OR r.strItemName LIKE '%Carton%' OR r.strItemName LIKE '%Label%' OR r.strItemName LIKE '%Liner%' OR r.strItemName LIKE '%Bottle%' OR r.strItemName LIKE '%Sticker%' OR r.strItemName LIKE '%Wrapper%' THEN 'Packaging Materials' ELSE 'Other' END
      ) AS mat_type,
      r.strUoMName AS uom,
      h.strTransactionTypeName AS txn_type,
      YEAR(h.dteTransactionDate) AS yr,
      MONTH(h.dteTransactionDate) AS mon,
      SUM(r.monTransactionValue) AS value,
      SUM(r.numTransactionQuantity) AS qty
    FROM wms.tblInventoryTransactionRowArc r
    JOIN wms.tblInventoryTransactionHeaderArc h ON r.intInventoryTransactionId = h.intInventoryTransactionId
    JOIN dco.tblbusinessunitArc b ON h.intBusinessUnitId = b.intBusinessUnitId
    LEFT JOIN itm.tblItemArc i ON r.intItemId = i.intItemId
    LEFT JOIN itm.tblItemMasterArc m ON i.intItemMasterId = m.intItemMasterId
    WHERE h.intBusinessUnitId IN (${SBU_IDS.join(',')})
      AND YEAR(h.dteTransactionDate) IN (${yrLast}, ${yrThis})
      AND h.TransactionGroupId = 2
    GROUP BY b.strBusinessUnitCode, b.strBusinessUnitName, r.intItemId,
      COALESCE(i.strItemCode, CAST(r.intItemId AS NVARCHAR(50))), r.strItemName,
      COALESCE(i.strItemTypeName, m.strItemMasterTypeName, CASE WHEN r.strItemName LIKE '%Bag%' OR r.strItemName LIKE '%Pack%' OR r.strItemName LIKE '%Carton%' OR r.strItemName LIKE '%Label%' OR r.strItemName LIKE '%Liner%' OR r.strItemName LIKE '%Bottle%' OR r.strItemName LIKE '%Sticker%' OR r.strItemName LIKE '%Wrapper%' THEN 'Packaging Materials' ELSE 'Other' END),
      r.strUoMName, h.strTransactionTypeName,
      YEAR(h.dteTransactionDate), MONTH(h.dteTransactionDate)
  `);
  console.log(`Fetched ${res.recordset.length} rows`);

  const byKey = {};
  res.recordset.forEach(r => {
    const key = `${r.sbu}|${r.sys_id}|${r.txn_type}|${r.mon}`;
    if (!byKey[key]) byKey[key] = { last: {value:0,qty:0}, this: {value:0,qty:0}, meta: null };
    if (!byKey[key].meta) {
      byKey[key].meta = { sbu: r.sbu, sbu_name: r.sbu_name, sys_id: r.sys_id, item_code: r.item_code, item_desc: r.item_desc, mat_type: r.mat_type, uom: r.uom || '', txn_type: r.txn_type, mon: r.mon };
    }
    if (r.yr === yrLast) { byKey[key].last.value += r.value; byKey[key].last.qty += r.qty; }
    if (r.yr === yrThis) { byKey[key].this.value += r.value; byKey[key].this.qty += r.qty; }
  });

  const yoyData = [];
  Object.values(byKey).forEach(v => {
    const m = v.meta;
    const rl = v.last.qty !== 0 ? Math.abs(v.last.value / v.last.qty) : 0;
    const rt = v.this.qty !== 0 ? Math.abs(v.this.value / v.this.qty) : 0;
    if (v.last.qty !== 0 && v.this.qty !== 0) {
      yoyData.push({
        sbu: m.sbu, sbu_name: m.sbu_name, sys_id: m.sys_id, item_code: m.item_code,
        item_code_display: `${m.item_code} (${m.sys_id})`, item_desc: m.item_desc,
        mat_type: m.mat_type, uom: m.uom, txn_type: m.txn_type, mon: m.mon,
        rate_last: Math.round(rl*100)/100, rate_this: Math.round(rt*100)/100,
        qty_this: Math.round(v.this.qty*100)/100, value_this: Math.round(v.this.value*100)/100,
        impact: Math.round((rt - rl) * Math.abs(v.this.qty)*100)/100
      });
    }
  });

  console.log(`Generated ${yoyData.length} YoY rows`);
  fs.writeFileSync(OUT + '\\yoy_data.js', 'const YOY_DATA = ' + JSON.stringify(yoyData) + ';');
  console.log('Saved yoy_data.js');
  await pool.close();
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
