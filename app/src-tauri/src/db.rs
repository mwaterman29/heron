use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DealRow {
    pub id: String,
    pub site: String,
    pub search_id: String,
    pub title: Option<String>,
    pub price: Option<f64>,
    pub price_usd: Option<f64>,
    pub currency: Option<String>,
    pub url: String,
    pub location: Option<String>,
    pub deal_tier: Option<String>,
    pub llm_reasoning: Option<String>,
    pub pass1_tier: Option<String>,
    pub pass1_reasoning: Option<String>,
    pub is_deal: i64,
    pub detail_fetched: i64,
    pub notified: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub times_seen: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceStat {
    pub site: String,
    pub total_items: u64,
    pub evaluated_items: u64,
    pub deals_flagged: u64,
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryFilter {
    pub tier: Option<String>,
    pub site: Option<String>,
    pub search: Option<String>,
    pub only_deals: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

fn row_to_deal(row: &Row) -> rusqlite::Result<DealRow> {
    Ok(DealRow {
        id: row.get(0)?,
        site: row.get(1)?,
        search_id: row.get(2)?,
        title: row.get(3)?,
        price: row.get(4)?,
        price_usd: row.get(5)?,
        currency: row.get(6)?,
        url: row.get(7)?,
        location: row.get(8)?,
        deal_tier: row.get(9)?,
        llm_reasoning: row.get(10)?,
        pass1_tier: row.get(11)?,
        pass1_reasoning: row.get(12)?,
        is_deal: row.get(13)?,
        detail_fetched: row.get(14)?,
        notified: row.get(15)?,
        first_seen_at: row.get(16)?,
        last_seen_at: row.get(17)?,
        times_seen: row.get(18)?,
    })
}

const DEAL_COLUMNS: &str = "id, site, search_id, title, price, price_usd, currency, url, location, \
     deal_tier, llm_reasoning, pass1_tier, pass1_reasoning, is_deal, detail_fetched, notified, \
     first_seen_at, last_seen_at, times_seen";

fn open_db(config_dir: &Path) -> rusqlite::Result<Option<Connection>> {
    let db_path = config_dir.join("data/seen_items.db");
    if !db_path.exists() {
        return Ok(None);
    }
    let conn = Connection::open(&db_path)?;
    Ok(Some(conn))
}

/// Get the N most recent deals (is_deal=1), sorted by last_seen_at DESC.
pub fn recent_deals(config_dir: &Path, limit: u32) -> rusqlite::Result<Vec<DealRow>> {
    let conn = match open_db(config_dir)? {
        Some(c) => c,
        None => return Ok(Vec::new()),
    };
    let sql = format!(
        "SELECT {} FROM seen_items WHERE is_deal = 1 ORDER BY last_seen_at DESC LIMIT ?1",
        DEAL_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([limit], row_to_deal)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Get filtered history rows.
pub fn history(config_dir: &Path, filter: HistoryFilter) -> rusqlite::Result<Vec<DealRow>> {
    let conn = match open_db(config_dir)? {
        Some(c) => c,
        None => return Ok(Vec::new()),
    };

    let mut clauses: Vec<String> = vec!["evaluated = 1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(tier) = &filter.tier {
        clauses.push("deal_tier = ?".to_string());
        params.push(Box::new(tier.clone()));
    }
    if let Some(site) = &filter.site {
        clauses.push("site = ?".to_string());
        params.push(Box::new(site.clone()));
    }
    if let Some(search) = &filter.search {
        clauses.push("(title LIKE ? OR url LIKE ?)".to_string());
        let pat = format!("%{}%", search);
        params.push(Box::new(pat.clone()));
        params.push(Box::new(pat));
    }
    if filter.only_deals.unwrap_or(false) {
        clauses.push("is_deal = 1".to_string());
    }

    let limit = filter.limit.unwrap_or(200).min(1000);
    let offset = filter.offset.unwrap_or(0);

    let where_sql = clauses.join(" AND ");
    let sql = format!(
        "SELECT {} FROM seen_items WHERE {} ORDER BY last_seen_at DESC LIMIT {} OFFSET {}",
        DEAL_COLUMNS, where_sql, limit, offset
    );

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(param_refs.iter()), row_to_deal)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Aggregate per-site stats for the Sources panel.
pub fn source_stats(config_dir: &Path) -> rusqlite::Result<Vec<SourceStat>> {
    let conn = match open_db(config_dir)? {
        Some(c) => c,
        None => return Ok(Vec::new()),
    };
    let mut stmt = conn.prepare(
        "SELECT site,
                COUNT(*) AS total,
                SUM(CASE WHEN evaluated = 1 THEN 1 ELSE 0 END) AS evaluated,
                SUM(CASE WHEN is_deal = 1 THEN 1 ELSE 0 END) AS deals,
                MAX(last_seen_at) AS last_seen_at
         FROM seen_items
         GROUP BY site
         ORDER BY site",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SourceStat {
                site: row.get(0)?,
                total_items: row.get::<_, i64>(1)? as u64,
                evaluated_items: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u64,
                deals_flagged: row.get::<_, Option<i64>>(3)?.unwrap_or(0) as u64,
                last_seen_at: row.get::<_, Option<i64>>(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewStats {
    pub total_items: u64,
    pub total_deals: u64,
    pub total_notified: u64,
    pub last_run_at: Option<i64>,
}

pub fn overview(config_dir: &Path) -> rusqlite::Result<OverviewStats> {
    let conn = match open_db(config_dir)? {
        Some(c) => c,
        None => return Ok(OverviewStats {
            total_items: 0,
            total_deals: 0,
            total_notified: 0,
            last_run_at: None,
        }),
    };
    let mut stmt = conn.prepare(
        "SELECT COUNT(*),
                SUM(CASE WHEN is_deal = 1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN notified = 1 THEN 1 ELSE 0 END),
                MAX(last_seen_at)
         FROM seen_items",
    )?;
    let row = stmt.query_row([], |row| {
        Ok(OverviewStats {
            total_items: row.get::<_, Option<i64>>(0)?.unwrap_or(0) as u64,
            total_deals: row.get::<_, Option<i64>>(1)?.unwrap_or(0) as u64,
            total_notified: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u64,
            last_run_at: row.get::<_, Option<i64>>(3)?,
        })
    })?;
    Ok(row)
}
