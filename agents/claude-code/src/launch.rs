//! `launch`: what to run to start Claude Code.

use std::ffi::OsStr;

use fleet_adapter_sdk::agent::{Launch, Launched};
use fleet_adapter_sdk::kit::{self, Error, agent::Argv};

/// Claude, by its absolute path on `path`, with the model and then the
/// first prompt as its arguments, and `config` handed on as
/// `CLAUDE_CONFIG_DIR` when it is set, so the agent keeps its sessions
/// where `read` looks.
///
/// # Errors
///
/// When no executable `claude` is on `path`, or `config` is not UTF-8.
pub(crate) fn launch(
    request: &Launch,
    path: Option<&OsStr>,
    config: Option<&OsStr>,
) -> Result<Launched, Error> {
    let claude =
        kit::find_program("claude", path).ok_or_else(|| Error::new("claude is not on the PATH"))?;
    let argv = Argv::program(&claude)?
        .option("--model", request.model.as_deref())
        .last(request.prompt.as_deref());
    let env = config
        .map(|c| {
            c.to_str()
                .map(|c| ("CLAUDE_CONFIG_DIR".to_owned(), c.to_owned()))
                .ok_or_else(|| {
                    Error::new(format!("CLAUDE_CONFIG_DIR {} is not UTF-8", c.display()))
                })
        })
        .transpose()?
        .into_iter()
        .collect();
    Ok(Launched { argv, env })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::io;

    use fleet_adapter_sdk::agent::Launch;
    use fleet_adapter_sdk::kit::testing::FakePath;

    /// A fake PATH holding an executable `claude`, and that `claude`'s path.
    fn bin() -> io::Result<(FakePath, String)> {
        let bin = FakePath::new()?;
        let claude = bin.program("claude", "exit 0")?.display().to_string();
        Ok((bin, claude))
    }

    fn ask(model: Option<&str>, prompt: Option<&str>) -> Launch {
        Launch {
            directory: "/c/app".into(),
            model: model.map(str::to_owned),
            prompt: prompt.map(str::to_owned),
        }
    }

    #[test]
    fn launch_runs_claude_by_its_absolute_path_with_model_then_prompt() -> io::Result<()> {
        let (bin, claude) = bin()?;
        let path = bin.path_var();
        let launched = launch(
            &ask(Some("sonnet"), Some("say hi; then wait")),
            Some(&path),
            None,
        );
        assert_eq!(
            launched.map(|l| l.argv),
            Ok(vec![
                claude.clone(),
                "--model=sonnet".into(),
                "--".into(),
                "say hi; then wait".into()
            ])
        );
        let launched = launch(&ask(None, None), Some(&path), None);
        assert_eq!(launched.map(|l| l.argv), Ok(vec![claude]));
        Ok(())
    }

    #[test]
    fn a_prompt_or_model_that_looks_like_a_flag_is_never_read_as_one() -> io::Result<()> {
        let (bin, claude) = bin()?;
        let launched = launch(
            &ask(Some("-p"), Some("--dangerously-skip-permissions now")),
            Some(&bin.path_var()),
            None,
        );
        assert_eq!(
            launched.map(|l| l.argv),
            Ok(vec![
                claude,
                "--model=-p".into(),
                "--".into(),
                "--dangerously-skip-permissions now".into()
            ])
        );
        Ok(())
    }

    #[test]
    fn the_agent_gets_the_config_dir_its_sessions_are_read_from() -> io::Result<()> {
        let (bin, _) = bin()?;
        let path = bin.path_var();
        let config = OsString::from("/cfg/claude");
        let launched = launch(&ask(None, None), Some(&path), Some(&config));
        assert_eq!(
            launched.map(|l| l.env.into_iter().collect::<Vec<_>>()),
            Ok(vec![(
                "CLAUDE_CONFIG_DIR".to_owned(),
                "/cfg/claude".to_owned()
            )])
        );
        let launched = launch(&ask(None, None), Some(&path), None);
        assert_eq!(launched.map(|l| l.env.is_empty()), Ok(true));
        Ok(())
    }

    #[test]
    fn a_model_or_a_prompt_alone_is_passed_alone() -> io::Result<()> {
        let (bin, claude) = bin()?;
        let path = bin.path_var();
        let launched = launch(&ask(Some("opus"), None), Some(&path), None);
        assert_eq!(
            launched.map(|l| l.argv),
            Ok(vec![claude.clone(), "--model=opus".into()])
        );
        let launched = launch(&ask(None, Some("hi")), Some(&path), None);
        assert_eq!(
            launched.map(|l| l.argv),
            Ok(vec![claude, "--".into(), "hi".into()])
        );
        Ok(())
    }

    #[test]
    fn a_config_dir_that_is_not_utf8_is_an_error_not_a_mangled_path() -> io::Result<()> {
        use std::os::unix::ffi::OsStrExt;
        let (bin, _) = bin()?;
        let config = OsStr::from_bytes(b"/cfg/\xffclaude");
        assert!(launch(&ask(None, None), Some(&bin.path_var()), Some(config)).is_err());
        Ok(())
    }

    #[test]
    fn launch_without_claude_on_the_path_fails() {
        let path = OsString::from("/nonexistent");
        assert!(launch(&ask(None, None), Some(&path), None).is_err());
        assert!(launch(&ask(None, None), None, None).is_err());
    }
}
