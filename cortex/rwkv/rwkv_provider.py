#!/usr/bin/env python3
import argparse
import json
import os
import sys
from typing import Any, Dict, List

os.environ.setdefault("RWKV_V7_ON", "0")
os.environ.setdefault("RWKV_JIT_ON", "0")
os.environ.setdefault("RWKV_CUDA_ON", "0")

from rwkv.model import RWKV
from rwkv.utils import PIPELINE

def normalize_model_base(model_path: str) -> str:
    p = os.path.abspath(model_path.strip())
    if p.lower().endswith(".pth"):
        p = p[:-4]
    return p

def resolve_model_file(model_base: str) -> str:
    if os.path.isfile(model_base):
        return model_base
    pth = model_base + ".pth"
    if os.path.isfile(pth):
        return pth
    return pth

def state_meta(state: Any) -> Dict[str, Any]:
    if state is None:
        return {"kind": "none"}
    if isinstance(state, list):
        shapes = []
        dtypes = []
        for t in state:
            shape = list(getattr(t, "shape", []))
            dtype = str(getattr(t, "dtype", "unknown"))
            shapes.append(shape)
            dtypes.append(dtype)
        return {
            "kind": "list",
            "items": len(state),
            "shapes_head": shapes[:8],
            "dtype_head": dtypes[:8],
        }
    return {"kind": type(state).__name__}

def load_model_and_pipeline(model_path: str, tokenizer_path: str, strategy: str):
    model_base = normalize_model_base(model_path)
    model = RWKV(model=model_base, strategy=strategy)
    pipeline = PIPELINE(model, tokenizer_path)
    return model, pipeline, model_base

def cmd_inspect(args) -> Dict[str, Any]:
    model_base = normalize_model_base(args.model_path)
    model_file = resolve_model_file(model_base)
    tokenizer_file = os.path.abspath(args.tokenizer_path)
    return {
        "ok": True,
        "python": sys.version,
        "env": {
            "RWKV_V7_ON": os.environ.get("RWKV_V7_ON"),
            "RWKV_JIT_ON": os.environ.get("RWKV_JIT_ON"),
            "RWKV_CUDA_ON": os.environ.get("RWKV_CUDA_ON"),
        },
        "model_base": model_base,
        "model_file": model_file,
        "model_exists": os.path.isfile(model_file),
        "tokenizer_file": tokenizer_file,
        "tokenizer_exists": os.path.isfile(tokenizer_file),
        "strategy": args.strategy,
    }

def cmd_eval(args) -> Dict[str, Any]:
    model, pipeline, model_base = load_model_and_pipeline(
        args.model_path, args.tokenizer_path, args.strategy
    )
    prompt = args.prompt or ""
    tokens = pipeline.encode(prompt) if prompt else []
    if not tokens:
        tokens = [0]

    out, state = model.forward(tokens, None)

    generated_tokens: List[int] = []
    for _ in range(max(1, int(args.max_new_tokens))):
        token = int(pipeline.sample_logits(out, temperature=float(args.temperature), top_p=float(args.top_p)))
        generated_tokens.append(token)
        out, state = model.forward([token], state)

    generated_text = pipeline.decode(generated_tokens)

    return {
        "ok": True,
        "model_base": model_base,
        "prompt_tokens": len(tokens),
        "generated_tokens": generated_tokens,
        "generated_text": generated_text,
        "state": state_meta(state),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["inspect", "eval"])
    parser.add_argument("--prompt", default="")
    parser.add_argument("--model-path", default=os.environ.get("RWKV_MODEL_PATH", ""))
    parser.add_argument("--tokenizer-path", default=os.environ.get("RWKV_TOKENIZER_PATH", ""))
    parser.add_argument("--strategy", default=os.environ.get("RWKV_STRATEGY", "cpu fp16"))
    parser.add_argument("--max-new-tokens", type=int, default=int(os.environ.get("RWKV_MAX_NEW_TOKENS", "24")))
    parser.add_argument("--temperature", type=float, default=float(os.environ.get("RWKV_TEMPERATURE", "0.7")))
    parser.add_argument("--top-p", type=float, default=float(os.environ.get("RWKV_TOP_P", "0.9")))
    args = parser.parse_args()

    try:
        if args.action == "inspect":
            out = cmd_inspect(args)
        else:
            out = cmd_eval(args)
    except Exception as e:
        out = {"ok": False, "error": str(e)}

    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
