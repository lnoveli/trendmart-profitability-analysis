"""
TrendMart — Pipeline de dados para o dashboard
Lê o Superstore, limpa, cria variáveis derivadas (Margem, Tempo_Envio_Dias,
RFM + clusters de clientes, clusters de sub-categorias, série temporal e
sazonalidade) e exporta um único JSON compacto para o front-end.
"""
import json
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

pd.set_option("mode.chained_assignment", None)

# ---------------------------------------------------------------
# 1. Carga e limpeza (ETL)
# ---------------------------------------------------------------
df = pd.read_csv("data/superstore.csv", encoding="latin-1")
df["Order Date"] = pd.to_datetime(df["Order Date"])
df["Ship Date"] = pd.to_datetime(df["Ship Date"])
df = df.drop_duplicates()

# ---------------------------------------------------------------
# 2. Variáveis derivadas (nível transação)
# ---------------------------------------------------------------
df["Margem"] = df["Profit"] / df["Sales"]
df["Margem"] = df["Margem"].replace([np.inf, -np.inf], np.nan)
df["Tempo_Envio_Dias"] = (df["Ship Date"] - df["Order Date"]).dt.days
df["Teve_Desconto"] = df["Discount"] > 0
df["Ano"] = df["Order Date"].dt.year
df["Mes"] = df["Order Date"].dt.month
df["AnoMes"] = df["Order Date"].dt.to_period("M").astype(str)

# ---------------------------------------------------------------
# 3. RFM + clustering de clientes
# ---------------------------------------------------------------
ref_date = df["Order Date"].max() + pd.Timedelta(days=1)

rfm = df.groupby(["Customer ID", "Customer Name", "Segment"]).agg(
    Recencia=("Order Date", lambda x: (ref_date - x.max()).days),
    Frequencia=("Order ID", "nunique"),
    Monetario=("Sales", "sum"),
    Lucro_Total=("Profit", "sum"),
).reset_index()
rfm["Margem_Cliente"] = rfm["Lucro_Total"] / rfm["Monetario"]

# clustering K-Means sobre R, F, M padronizados
X = rfm[["Recencia", "Frequencia", "Monetario"]].copy()
X_log = np.log1p(X[["Frequencia", "Monetario"]])
X_scaled = StandardScaler().fit_transform(
    pd.concat([X["Recencia"], X_log], axis=1)
)
km_cust = KMeans(n_clusters=4, random_state=42, n_init=10)
rfm["Cluster"] = km_cust.fit_predict(X_scaled)

# nomear clusters por perfil (recência baixa + freq/monet alto = melhor)
profile = rfm.groupby("Cluster")[["Recencia", "Frequencia", "Monetario"]].mean()
profile["score"] = (-profile["Recencia"].rank() + profile["Frequencia"].rank() + profile["Monetario"].rank())
order = profile.sort_values("score", ascending=False).index.tolist()
names = ["Campeões", "Fiéis", "Em Risco", "Ocasionais"]
name_map = {cluster_id: names[i] for i, cluster_id in enumerate(order)}
rfm["Cluster_Nome"] = rfm["Cluster"].map(name_map)

rfm_out = rfm.rename(columns={
    "Customer ID": "customer_id", "Customer Name": "customer_name", "Segment": "segment",
    "Recencia": "recency", "Frequencia": "frequency", "Monetario": "monetary",
    "Lucro_Total": "profit_total", "Margem_Cliente": "margin", "Cluster_Nome": "cluster_name"
})[["customer_id", "customer_name", "segment", "recency", "frequency", "monetary",
    "profit_total", "margin", "cluster_name"]].copy()
rfm_out["monetary"] = rfm_out["monetary"].round(2)
rfm_out["profit_total"] = rfm_out["profit_total"].round(2)
rfm_out["margin"] = rfm_out["margin"].round(4)

cluster_summary = rfm.groupby("Cluster_Nome").agg(
    n_clientes=("Customer ID", "nunique"),
    recencia_media=("Recencia", "mean"),
    frequencia_media=("Frequencia", "mean"),
    monetario_medio=("Monetario", "mean"),
    margem_media=("Margem_Cliente", "mean"),
).round(2).reset_index().rename(columns={"Cluster_Nome": "cluster_name"})

# ---------------------------------------------------------------
# 4. Clustering de sub-categorias (produtos) por perfil de rentabilidade
# ---------------------------------------------------------------
sub = df.groupby(["Category", "Sub-Category"]).agg(
    total_vendas=("Sales", "sum"),
    total_lucro=("Profit", "sum"),
    desconto_medio=("Discount", "mean"),
    qtd_pedidos=("Order ID", "nunique"),
).reset_index()
sub["margem"] = sub["total_lucro"] / sub["total_vendas"]

feat_scaled = StandardScaler().fit_transform(sub[["margem"]])
km_prod = KMeans(n_clusters=3, random_state=42, n_init=10)
sub["cluster"] = km_prod.fit_predict(feat_scaled)

# ordena clusters pela margem média (decrescente) para nomear de forma consistente
prof = sub.groupby("cluster")["margem"].mean().sort_values(ascending=False)
prod_names = ["Estrelas", "Alavancáveis", "Críticas"]
prod_name_map = {cid: prod_names[i] for i, cid in enumerate(prof.index.tolist())}
sub["cluster_name"] = sub["cluster"].map(prod_name_map)

sub_out = sub.rename(columns={"Category": "category", "Sub-Category": "subcategory"})[[
    "category", "subcategory", "total_vendas", "total_lucro", "desconto_medio",
    "qtd_pedidos", "margem", "cluster_name"
]].round(4)

# ---------------------------------------------------------------
# 5. Série temporal e sazonalidade
# ---------------------------------------------------------------
monthly = df.groupby("AnoMes").agg(
    sales=("Sales", "sum"), profit=("Profit", "sum")
).reset_index().sort_values("AnoMes")
monthly["margin"] = monthly["profit"] / monthly["sales"]
monthly_out = monthly.round(2).to_dict(orient="records")

heat = df.groupby(["Ano", "Mes"]).agg(sales=("Sales", "sum")).reset_index()
heat_out = heat.round(2).to_dict(orient="records")

# ---------------------------------------------------------------
# 6. Transações (linha a linha, campos essenciais) para filtros no front-end
# ---------------------------------------------------------------
tx = df[[
    "Order ID", "Order Date", "Customer ID", "Segment", "Region", "State", "City",
    "Category", "Sub-Category", "Sales", "Quantity", "Discount", "Profit", "Margem",
    "Tempo_Envio_Dias", "Ship Mode"
]].copy()
tx["Order Date"] = tx["Order Date"].dt.strftime("%Y-%m-%d")
tx = tx.rename(columns={
    "Order ID": "order_id", "Order Date": "date", "Customer ID": "customer_id",
    "Segment": "segment", "Region": "region", "State": "state", "City": "city",
    "Category": "category", "Sub-Category": "subcategory", "Sales": "sales",
    "Quantity": "qty", "Discount": "discount", "Profit": "profit", "Margem": "margin",
    "Tempo_Envio_Dias": "ship_days", "Ship Mode": "ship_mode"
})
tx["sales"] = tx["sales"].round(2)
tx["profit"] = tx["profit"].round(2)
tx["margin"] = tx["margin"].round(4)
tx["discount"] = tx["discount"].round(2)

# ---------------------------------------------------------------
# 7. KPIs gerais
# ---------------------------------------------------------------
kpis = {
    "total_vendas": round(df["Sales"].sum(), 2),
    "total_lucro": round(df["Profit"].sum(), 2),
    "margem_geral": round(df["Profit"].sum() / df["Sales"].sum(), 4),
    "qtd_pedidos": int(df["Order ID"].nunique()),
    "qtd_clientes": int(df["Customer ID"].nunique()),
    "ticket_medio": round(df.groupby("Order ID")["Sales"].sum().mean(), 2),
    "tempo_envio_medio": round(df["Tempo_Envio_Dias"].mean(), 1),
    "periodo_inicio": df["Order Date"].min().strftime("%Y-%m-%d"),
    "periodo_fim": df["Order Date"].max().strftime("%Y-%m-%d"),
}

# ---------------------------------------------------------------
# 8. Export
# ---------------------------------------------------------------
payload = {
    "kpis": kpis,
    "transactions": tx.to_dict(orient="records"),
    "customers_rfm": rfm_out.to_dict(orient="records"),
    "customer_clusters_summary": cluster_summary.to_dict(orient="records"),
    "subcategory_clusters": sub_out.to_dict(orient="records"),
    "monthly_ts": monthly_out,
    "seasonality": heat_out,
}

with open("data.json", "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

print("KPIs:", kpis)
print("Transações:", len(tx), "| Clientes RFM:", len(rfm_out), "| Sub-categorias:", len(sub_out))
print("Tamanho do JSON (KB):", round(__import__('os').path.getsize('data.json')/1024, 1))
