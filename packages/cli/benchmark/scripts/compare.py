#!/usr/bin/env python3
"""Compare two benchmark runs and show savings."""
import json, sys

b1_path = sys.argv[1]  # baseline
b2_path = sys.argv[2]  # yats

with open(b1_path) as f: b1 = json.load(f)
with open(b2_path) as f: b2 = json.load(f)

t1 = b1["total_tokens"]
t2 = b2["total_tokens"]
c1 = b1["cost_usd"]
c2 = b2["cost_usd"]
token_save = (1 - t2/t1) * 100 if t1 else 0
cost_save = (1 - c2/c1) * 100 if c1 else 0

print(f"""
╔═══════════════════════════════════════════════════════════╗
║                   YATS BENCHMARK                         ║
╠═══════════════════════════════════════════════════════════╣
║                                                         ║
║  {'':10s} {'BASELINE':>15s}  {'YATS':>15s}  {'SAVINGS':>12s} ║
║  {'─'*58} ║
║  {'Tokens':10s} {t1:>15,d}  {t2:>15,d}  {token_save:>+11.1f}% ║
║  {'Cost':10s} {'$'+str(round(c1,4)):>15s}  {'$'+str(round(c2,4)):>15s}  {cost_save:>+11.1f}% ║
║  {'─'*58} ║
║  {'Strategy':10s} {'':>15s}  {'':>15s}  {'':>12s} ║
║  {'YATS queries':10s} {b1['strategy']['yats_queries']:>15}  {b2['strategy']['yats_queries']:>15}  {'':>12s} ║
║  {'File reads':10s} {b1['strategy']['file_reads']:>15}  {b2['strategy']['file_reads']:>15}  {(((1 - b2['strategy']['file_reads']/b1['strategy']['file_reads'])*100) if b1['strategy']['file_reads'] else 0):>+11.1f}% ║
║  {'Bash cmds':10s} {b1['strategy']['bash_commands']:>15}  {b2['strategy']['bash_commands']:>15}  {(((1 - b2['strategy']['bash_commands']/b1['strategy']['bash_commands'])*100) if b1['strategy']['bash_commands'] else 0):>+11.1f}% ║
║  {'Agent spawns':10s} {b1['strategy']['agent_spawns']:>15}  {b2['strategy']['agent_spawns']:>15}  {'':>12s} ║
║  {'Content':10s} {b1['content_chars']:>15,}  {b2['content_chars']:>15,}  {(((1 - b2['content_chars']/b1['content_chars'])*100) if b1['content_chars'] else 0):>+11.1f}% ║
║  {'─'*58} ║
║  {'Tokens':10s} {'':>15s}  {'':>15s}  {'':>12s} ║
║  {'  Input':10s} {b1['tokens']['input_tokens']:>15,d}  {b2['tokens']['input_tokens']:>15,d}  {'':>12s} ║
║  {'  Output':10s} {b1['tokens']['output_tokens']:>15,d}  {b2['tokens']['output_tokens']:>15,d}  {'← mas caro':>12s} ║
║  {'  Cache R':10s} {b1['tokens']['cache_read_input_tokens']:>15,d}  {b2['tokens']['cache_read_input_tokens']:>15,d}  {'← barato':>12s} ║
║  {'  Cache W':10s} {b1['tokens']['cache_creation_input_tokens']:>15,d}  {b2['tokens']['cache_creation_input_tokens']:>15,d}  {'← caro':>12s} ║
║                                                         ║
╚═══════════════════════════════════════════════════════════╝
""")
