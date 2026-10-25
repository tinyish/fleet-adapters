//! fleet-claude-code keeps the rules every agent adapter keeps.

use fleet_adapter_sdk::kit::testing::conformance::{self, Adapter};
use fleet_adapter_sdk::kit::testing::{FakePath, TempDir};

#[test]
fn passes_the_agent_conformance_checks() -> std::io::Result<()> {
    let bin = FakePath::new()?;
    bin.program("claude", "exit 0")?;
    let config = TempDir::new("claude-config")?;
    let work = TempDir::new("claude-work")?;
    let adapter = Adapter::new(env!("CARGO_BIN_EXE_fleet-claude-code"))
        .env("PATH", bin.path_var())
        .env("CLAUDE_CONFIG_DIR", config.path());
    let breaches = conformance::agent(&adapter, work.path());
    assert!(breaches.is_empty(), "{breaches:#?}");
    Ok(())
}
