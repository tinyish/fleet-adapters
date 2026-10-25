//! `fleet-claude-code`: tinyfleet's adapter for Claude Code (README.md says
//! what it answers). The protocol and the run loop are
//! `fleet-adapter-sdk`'s.

mod launch;
mod read;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use fleet_adapter_sdk::agent::{Launch, Launched, Read, Readings};
use fleet_adapter_sdk::kit::{self, Error, agent::AgentAdapter};

fn main() -> ExitCode {
    kit::agent::run(&ClaudeCode::from_env())
}

/// Claude Code, as this machine's environment finds it.
struct ClaudeCode {
    /// `PATH`, where `claude` is looked for.
    path: Option<OsString>,
    /// `CLAUDE_CONFIG_DIR`, when it is set and not empty: handed on to the
    /// agent, so it keeps its sessions where `read` looks.
    config_var: Option<OsString>,
    /// Where Claude keeps its sessions: that, or `~/.claude`.
    config: Option<PathBuf>,
}

impl ClaudeCode {
    fn from_env() -> ClaudeCode {
        ClaudeCode::reading(|name| std::env::var_os(name))
    }

    /// Claude Code as `env` finds it. A relative `CLAUDE_CONFIG_DIR` is
    /// passed over, here as by `kit::config_dir`, so the agent and `read`
    /// both use `~/.claude`.
    fn reading(env: impl Fn(&str) -> Option<OsString>) -> ClaudeCode {
        let config = kit::config_dir("CLAUDE_CONFIG_DIR", ".claude", &env);
        ClaudeCode {
            path: env("PATH"),
            config_var: env("CLAUDE_CONFIG_DIR")
                .filter(|v| config.as_deref() == Some(Path::new(v))),
            config,
        }
    }
}

impl AgentAdapter for ClaudeCode {
    fn launch(&self, request: &Launch) -> Result<Launched, Error> {
        launch::launch(request, self.path.as_deref(), self.config_var.as_deref())
    }

    fn read(&self, request: &Read) -> Result<Readings, Error> {
        let config = self
            .config
            .as_deref()
            .ok_or_else(|| Error::new("neither CLAUDE_CONFIG_DIR nor HOME is set"))?;
        Ok(read::readings(config, request))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_claude_config_dir_is_passed_over_for_home() {
        let claude = ClaudeCode::reading(|name: &str| match name {
            "CLAUDE_CONFIG_DIR" => Some(OsString::from("rel/claude")),
            "HOME" => Some(OsString::from("/home/me")),
            _ => None,
        });
        assert_eq!(claude.config_var, None);
        assert_eq!(claude.config, Some(PathBuf::from("/home/me/.claude")));
    }

    #[test]
    fn an_absolute_claude_config_dir_is_read_and_handed_on() {
        let claude = ClaudeCode::reading(|name: &str| match name {
            "CLAUDE_CONFIG_DIR" => Some(OsString::from("/cfg/claude")),
            "HOME" => Some(OsString::from("/home/me")),
            _ => None,
        });
        assert_eq!(claude.config_var, Some(OsString::from("/cfg/claude")));
        assert_eq!(claude.config, Some(PathBuf::from("/cfg/claude")));
    }
}
