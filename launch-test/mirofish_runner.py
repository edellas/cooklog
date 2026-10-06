#!/usr/bin/env python3
"""Runs every concept in concepts/ through a running MiroFish backend, end to end:

    seed.md -> ontology -> knowledge graph -> agents -> social simulation
            -> interview of every agent (SI / FORSE / NO) -> report

Results go to results/<concept>/ and a comparison table to results/SUMMARY.md.
Only the Python standard library is used.

Usage:
    python3 mirofish_runner.py                 # all concepts
    python3 mirofish_runner.py 01-canzone-ai   # only some
Env:
    MIROFISH_URL   backend URL (default http://127.0.0.1:5001)
    MIROFISH_LANG  language sent as Accept-Language (default "it")
    MAX_ROUNDS     simulation rounds per concept (default 30; MiroFish suggests < 40 for a first try)
"""
import json
import os
import re
import sys
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = os.environ.get("MIROFISH_URL", "http://127.0.0.1:5001").rstrip("/")
LANG = os.environ.get("MIROFISH_LANG", "it")
MAX_ROUNDS = int(os.environ.get("MAX_ROUNDS", "30"))
POLL_SCALE = float(os.environ.get("POLL_SCALE", "1"))  # tests only


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def request(method, path, body=None, files=None, form=None, timeout=600):
    url = BASE + path
    headers = {"Accept-Language": LANG}
    data = None
    if files is not None:
        boundary = uuid.uuid4().hex
        parts = []
        for key, value in (form or {}).items():
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            )
        for key, path_ in files:
            content = Path(path_).read_bytes()
            parts.append(
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; '
                    f'filename="{Path(path_).name}"\r\nContent-Type: text/markdown\r\n\r\n'
                ).encode()
                + content
                + b"\r\n"
            )
        parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(parts)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        text = err.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {err.code}: {text[:500]}") from None
    if payload.get("success") is False:
        raise RuntimeError(f"{method} {path} -> {payload.get('error')}")
    return payload.get("data", payload)


def wait(label, poll, done, failed=lambda d: False, every=10, timeout=3 * 3600):
    start = time.time()
    last = None
    while True:
        data = poll()
        if failed(data):
            raise RuntimeError(f"{label} failed: {json.dumps(data, ensure_ascii=False)[:800]}")
        if done(data):
            return data
        msg = data.get("message") or data.get("runner_status") or data.get("status")
        progress = data.get("progress", data.get("progress_percent"))
        line = f"{label}: {msg} ({progress})"
        if line != last:
            log(line)
            last = line
        if time.time() - start > timeout:
            raise TimeoutError(f"{label} timed out")
        time.sleep(every * POLL_SCALE)


ANSWER = re.compile(r"^\W*(s[iì]|forse|no)\b", re.IGNORECASE)


def classify(text):
    m = ANSWER.match(text or "")
    if not m:
        return "altro"
    word = m.group(1).lower()
    return "si" if word.startswith("s") else word


def run_concept(concept_dir: Path):
    meta = json.loads((concept_dir / "concept.json").read_text())
    out = HERE / "results" / concept_dir.name
    out.mkdir(parents=True, exist_ok=True)
    state_file = out / "state.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {}

    def save():
        state_file.write_text(json.dumps(state, indent=2, ensure_ascii=False))

    log(f"=== {meta['name']} ===")

    if "project_id" not in state:
        data = request(
            "POST",
            "/api/graph/ontology/generate",
            files=[("files", concept_dir / "seed.md")],
            form={
                "simulation_requirement": meta["simulation_requirement"],
                "project_name": meta["name"],
                "additional_context": "Mercato italiano. Tutti i contenuti e le risposte devono essere in italiano.",
            },
            timeout=1800,
        )
        state["project_id"] = data["project_id"]
        save()
        log(f"ontology ok, project {state['project_id']}")

    if "graph_id" not in state:
        project = request("GET", f"/api/graph/project/{state['project_id']}")
        if not project.get("graph_id") or project.get("status") != "graph_completed":
            task = request("POST", "/api/graph/build", {"project_id": state["project_id"], "graph_name": meta["name"]})
            wait(
                "graph",
                lambda: request("GET", f"/api/graph/task/{task['task_id']}"),
                done=lambda d: d.get("status") == "completed",
                failed=lambda d: d.get("status") == "failed",
            )
            project = request("GET", f"/api/graph/project/{state['project_id']}")
        state["graph_id"] = project["graph_id"]
        save()
        log(f"graph ok, {state['graph_id']}")

    if "simulation_id" not in state:
        sim = request(
            "POST",
            "/api/simulation/create",
            {"project_id": state["project_id"], "graph_id": state["graph_id"], "enable_twitter": True, "enable_reddit": True},
        )
        state["simulation_id"] = sim["simulation_id"]
        save()
    sim_id = state["simulation_id"]

    if not state.get("prepared"):
        prep = request(
            "POST",
            "/api/simulation/prepare",
            {"simulation_id": sim_id, "use_llm_for_profiles": True, "parallel_profile_count": 5},
        )
        if not prep.get("already_prepared"):
            wait(
                "agents",
                lambda: request("POST", "/api/simulation/prepare/status", {"task_id": prep.get("task_id"), "simulation_id": sim_id}),
                done=lambda d: d.get("status") in ("completed", "ready") or d.get("already_prepared"),
                failed=lambda d: d.get("status") == "failed",
            )
        state["prepared"] = True
        save()
        log("agents ok")

    if not state.get("simulated"):
        request(
            "POST",
            "/api/simulation/start",
            {"simulation_id": sim_id, "platform": "parallel", "max_rounds": MAX_ROUNDS, "enable_graph_memory_update": True},
        )
        wait(
            "simulation",
            lambda: request("GET", f"/api/simulation/{sim_id}/run-status"),
            done=lambda d: d.get("runner_status") in ("completed", "stopped")
            or (d.get("total_rounds") and d.get("current_round", 0) >= d["total_rounds"]),
            failed=lambda d: d.get("runner_status") == "failed",
            every=20,
        )
        state["simulated"] = True
        save()
        log("simulation ok")

    if "interviews" not in state:
        env = request("POST", "/api/simulation/env-status", {"simulation_id": sim_id})
        if env.get("env_alive"):
            res = request(
                "POST",
                "/api/simulation/interview/all",
                {"simulation_id": sim_id, "prompt": meta["interview_question"], "timeout": 600},
                timeout=900,
            )
            results = (res.get("result") or {}).get("results") or {}
            answers = []
            for key, item in results.items():
                text = item.get("response") or ""
                answers.append({"key": key, "platform": item.get("platform"), "answer": classify(text), "response": text})
            state["interviews"] = answers
        else:
            log("environment not alive: interviews skipped")
            state["interviews"] = []
        save()
        (out / "interviews.json").write_text(json.dumps(state["interviews"], indent=2, ensure_ascii=False))

    if "report_id" not in state:
        rep = request("POST", "/api/report/generate", {"simulation_id": sim_id})
        status = wait(
            "report",
            lambda: request("POST", "/api/report/generate/status", {"task_id": rep.get("task_id"), "simulation_id": sim_id}),
            done=lambda d: d.get("status") == "completed",
            failed=lambda d: d.get("status") == "failed",
        )
        report_id = rep.get("report_id") or (status.get("result") or {}).get("report_id") or status.get("report_id")
        if not report_id:
            report_id = request("GET", f"/api/report/by-simulation/{sim_id}")["report_id"]
        state["report_id"] = report_id
        save()
    report = request("GET", f"/api/report/{state['report_id']}")
    (out / "report.md").write_text(report.get("markdown_content") or "")

    try:
        request("POST", "/api/simulation/close-env", {"simulation_id": sim_id})
    except Exception as err:  # the env may already be closed
        log(f"close-env: {err}")
    log(f"done: {out}")
    return meta, state


def summarize(rows):
    lines = [
        "# Confronto dei concept (simulazione MiroFish)",
        "",
        "Risposte degli agenti simulati alla domanda finale «lo compreresti?».",
        "Sono personaggi generati da un'IA, non clienti veri: usare il confronto tra concept,",
        "non i numeri assoluti, e confermare il vincitore con un test reale (vedi README).",
        "",
        "| Concept | Prezzo | Intervistati | SÌ | FORSE | NO | Indice (SÌ + ½ FORSE) |",
        "|---|---|---|---|---|---|---|",
    ]
    for meta, state in rows:
        answers = [a for a in state.get("interviews", []) if a["answer"] != "altro"]
        n = len(answers) or 1
        si = sum(a["answer"] == "si" for a in answers)
        forse = sum(a["answer"] == "forse" for a in answers)
        no = sum(a["answer"] == "no" for a in answers)
        index = (si + forse / 2) / n * 100
        lines.append(
            f"| {meta['name']} | {meta['price']} | {len(answers)} | {si} | {forse} | {no} | {index:.0f}% |"
        )
    lines.append("")
    lines.append("I report completi sono in results/<concept>/report.md, le singole risposte in interviews.json.")
    (HERE / "results" / "SUMMARY.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


def main():
    only = set(sys.argv[1:])
    concepts = sorted(p for p in (HERE / "concepts").iterdir() if (p / "concept.json").exists())
    if only:
        concepts = [p for p in concepts if p.name in only]
    request("GET", "/health")
    rows = []
    for concept in concepts:
        try:
            rows.append(run_concept(concept))
        except Exception as err:
            log(f"ERROR in {concept.name}: {err}")
            log("Re-run the same command to resume from the last completed step.")
    # Include concepts completed in earlier runs too.
    done = {m["name"] for m, _ in rows}
    for concept in sorted((HERE / "concepts").iterdir()):
        state_file = HERE / "results" / concept.name / "state.json"
        if state_file.exists() and (concept / "concept.json").exists():
            meta = json.loads((concept / "concept.json").read_text())
            state = json.loads(state_file.read_text())
            if meta["name"] not in done and "interviews" in state:
                rows.append((meta, state))
    if rows:
        summarize(rows)


if __name__ == "__main__":
    main()
